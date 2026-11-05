-- =====================================================================
--  CS Amusement - Autoscontri usati
--  01: struttura archivio, regole di sicurezza, deposito foto
--  Da incollare UNA volta in Supabase > SQL Editor > Run
-- =====================================================================

-- ---------- Amministratori (solo chi è in questa lista può gestire) ----------
create table if not exists public.amministratori (
  email text primary key
);
insert into public.amministratori (email) values ('ricambi@csamusement.it')
on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.amministratori a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Impostazioni generali (una sola riga) ----------
create table if not exists public.impostazioni (
  id   int primary key default 1 check (id = 1),
  tema text not null default 'A' check (tema in ('A', 'B'))
);
insert into public.impostazioni (id) values (1) on conflict do nothing;

-- ---------- Liste modificabili dall'admin ----------
create table if not exists public.modelli (
  id     bigint generated always as identity primary key,
  nome   text not null unique check (char_length(nome) between 1 and 80),
  ordine int  not null default 0,
  attivo boolean not null default true
);

create table if not exists public.caratteristiche (
  id     bigint generated always as identity primary key,
  nome   text not null unique check (char_length(nome) between 1 and 60),
  ordine int  not null default 0,
  attivo boolean not null default true
);
insert into public.caratteristiche (nome, ordine) values
  ('Drift', 1), ('Luci sotto il telaio', 2)
on conflict do nothing;

-- ---------- Annunci (NESSUN dato personale qui dentro) ----------
create table if not exists public.annunci (
  id                bigint generated always as identity primary key,
  codice            text generated always as ('CS-' || lpad(id::text, 4, '0')) stored,
  modello_id        bigint references public.modelli(id) on delete set null,
  modello_altro     text check (char_length(modello_altro) <= 80),
  anno              int  not null check (anno between 1950 and 2100),
  quantita          int  not null check (quantita between 1 and 500),
  condizione        text not null check (condizione in ('ottimo', 'buono', 'da_revisionare')),
  disponibile_da    date not null,
  paese             text not null check (paese in ('italia', 'estero')),
  prezzo            numeric(12,2) check (prezzo >= 0),
  mostra_prezzo     boolean not null default false,
  caratteristiche   bigint[] not null default '{}',
  note              text check (char_length(note) <= 2000),
  stato             text not null default 'in_attesa'
                    check (stato in ('in_attesa', 'approvato', 'rifiutato', 'venduto', 'archiviato')),
  creato_il         timestamptz not null default now(),
  pubblicato_il     timestamptz,
  rifiutato_il      timestamptz,
  venduto_il        date,
  archiviato_il     timestamptz,
  scadenza_avvisata_il timestamptz
);
create index if not exists annunci_stato_idx on public.annunci (stato);

-- ---------- Dati del venditore: tabella separata, MAI pubblica ----------
create table if not exists public.contatti_venditori (
  annuncio_id bigint primary key references public.annunci(id) on delete cascade,
  nome        text not null check (char_length(nome) between 1 and 100),
  email       text not null check (char_length(email) <= 200),
  telefono    text check (char_length(telefono) <= 40),
  consenso_il timestamptz not null      -- solo data e ora del consenso
);
create index if not exists contatti_email_idx on public.contatti_venditori (lower(email));

-- ---------- Foto ----------
create table if not exists public.foto (
  id             bigint generated always as identity primary key,
  annuncio_id    bigint not null references public.annunci(id) on delete cascade,
  path_privato   text not null unique,  -- originale compresso (deposito privato)
  path_pubblico  text,                  -- copia con filigrana (deposito pubblico), solo se approvato
  ordine         int not null default 0
);
create index if not exists foto_annuncio_idx on public.foto (annuncio_id);

-- =====================================================================
--  Regole di sicurezza (RLS): chi può vedere / modificare cosa
-- =====================================================================
alter table public.amministratori      enable row level security;
alter table public.impostazioni        enable row level security;
alter table public.modelli             enable row level security;
alter table public.caratteristiche     enable row level security;
alter table public.annunci             enable row level security;
alter table public.contatti_venditori  enable row level security;
alter table public.foto                enable row level security;

-- Impostazioni / modelli / caratteristiche: tutti leggono, solo admin modifica
create policy "lettura pubblica" on public.impostazioni    for select using (true);
create policy "admin modifica"   on public.impostazioni    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "lettura pubblica" on public.modelli         for select using (true);
create policy "admin modifica"   on public.modelli         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "lettura pubblica" on public.caratteristiche for select using (true);
create policy "admin modifica"   on public.caratteristiche for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Annunci: il pubblico vede SOLO approvati e venduti; l'admin vede e modifica tutto
create policy "pubblico vede approvati" on public.annunci for select
  using (stato in ('approvato', 'venduto'));
create policy "admin tutto" on public.annunci for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Contatti venditori: SOLO admin
create policy "solo admin" on public.contatti_venditori for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Amministratori: solo admin legge
create policy "solo admin" on public.amministratori for select to authenticated
  using (public.is_admin());

-- Foto: il pubblico vede solo le foto pubblicate di annunci visibili
create policy "pubblico vede foto pubblicate" on public.foto for select
  using (
    path_pubblico is not null
    and exists (select 1 from public.annunci a
                where a.id = foto.annuncio_id and a.stato in ('approvato', 'venduto'))
  );
create policy "admin tutto" on public.foto for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Permessi di base per l'accesso via sito
grant usage on schema public to anon, authenticated;
grant select on public.impostazioni, public.modelli, public.caratteristiche,
                public.annunci, public.foto to anon, authenticated;
grant insert, update, delete on public.impostazioni, public.modelli, public.caratteristiche,
                public.annunci, public.foto, public.contatti_venditori to authenticated;
grant select on public.contatti_venditori, public.amministratori to authenticated;

-- =====================================================================
--  Deposito foto
--   foto-private  : originali compressi, nessuno li vede tranne l'admin
--   foto-pubbliche: copie con filigrana, visibili nel catalogo
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('foto-private',   'foto-private',   false, 2097152, array['image/jpeg', 'image/webp']),
  ('foto-pubbliche', 'foto-pubbliche', true,  2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Chiunque può CARICARE (non leggere) foto nella cartella "incoming" del deposito privato
create policy "carica proposte" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'foto-private' and (storage.foldername(name))[1] = 'incoming');

-- L'admin gestisce tutto in entrambi i depositi
create policy "admin legge foto"    on storage.objects for select to authenticated
  using (bucket_id in ('foto-private', 'foto-pubbliche') and public.is_admin());
create policy "admin aggiorna foto" on storage.objects for update to authenticated
  using (bucket_id in ('foto-private', 'foto-pubbliche') and public.is_admin());
create policy "admin cancella foto" on storage.objects for delete to authenticated
  using (bucket_id in ('foto-private', 'foto-pubbliche') and public.is_admin());
create policy "admin carica foto"   on storage.objects for insert to authenticated
  with check (bucket_id in ('foto-private', 'foto-pubbliche') and public.is_admin());

-- =====================================================================
--  Invio di una proposta dal modulo pubblico (con controlli anti-spam)
--  Nessun IP o dato del dispositivo viene salvato.
-- =====================================================================
create or replace function public.invia_proposta(
  p_modello_id      bigint,
  p_modello_altro   text,
  p_anno            int,
  p_quantita        int,
  p_condizione      text,
  p_disponibile_da  date,
  p_paese           text,
  p_prezzo          numeric,
  p_mostra_prezzo   boolean,
  p_caratteristiche bigint[],
  p_note            text,
  p_nome            text,
  p_email           text,
  p_telefono        text,
  p_consenso        boolean,
  p_foto            text[],
  p_trappola        text,     -- campo nascosto: se compilato è un robot
  p_secondi         int       -- secondi impiegati a compilare
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
  v_codice text;
  v_n int;
  v_i int;
begin
  -- Anti-spam
  if coalesce(p_trappola, '') <> '' or coalesce(p_secondi, 0) < 15 then
    raise exception 'Invio non valido. Riprova.';
  end if;
  if (select count(*) from public.annunci where creato_il > now() - interval '1 hour') >= 30 then
    raise exception 'Troppe proposte in questo momento. Riprova tra un''ora.';
  end if;
  if (select count(*) from public.contatti_venditori
      where lower(email) = lower(trim(p_email)) and consenso_il > now() - interval '1 day') >= 5 then
    raise exception 'Hai già inviato molte proposte oggi. Riprova domani.';
  end if;

  -- Controlli sui dati
  if p_consenso is not true then
    raise exception 'Devi accettare Informativa Privacy e Condizioni d''uso.';
  end if;
  if trim(coalesce(p_email, '')) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indirizzo email non valido.';
  end if;
  if trim(coalesce(p_nome, '')) = '' then
    raise exception 'Inserisci il nome.';
  end if;
  if p_modello_id is null and trim(coalesce(p_modello_altro, '')) = '' then
    raise exception 'Indica il modello.';
  end if;
  if p_disponibile_da is null then
    raise exception 'Indica da quando è disponibile.';
  end if;
  v_n := coalesce(array_length(p_foto, 1), 0);
  if v_n < 1 or v_n > 12 then
    raise exception 'Carica da 1 a 12 foto.';
  end if;
  -- Le foto devono essere state caricate davvero, nella cartella giusta, e non già usate
  if (select count(*) from storage.objects o
      where o.bucket_id = 'foto-private' and o.name = any(p_foto)
        and o.name like 'incoming/%') <> v_n
     or exists (select 1 from public.foto f where f.path_privato = any(p_foto)) then
    raise exception 'Problema con le foto caricate. Riprova.';
  end if;

  insert into public.annunci (modello_id, modello_altro, anno, quantita, condizione,
    disponibile_da, paese, prezzo, mostra_prezzo, caratteristiche, note)
  values (p_modello_id, nullif(trim(p_modello_altro), ''), p_anno, p_quantita, p_condizione,
    p_disponibile_da, p_paese, p_prezzo, coalesce(p_mostra_prezzo, false),
    coalesce(p_caratteristiche, '{}'), nullif(trim(p_note), ''))
  returning id, codice into v_id, v_codice;

  insert into public.contatti_venditori (annuncio_id, nome, email, telefono, consenso_il)
  values (v_id, trim(p_nome), lower(trim(p_email)), nullif(trim(p_telefono), ''), now());

  for v_i in 1..v_n loop
    insert into public.foto (annuncio_id, path_privato, ordine) values (v_id, p_foto[v_i], v_i);
  end loop;

  return v_codice;
end;
$$;

revoke all on function public.invia_proposta from public;
grant execute on function public.invia_proposta to anon, authenticated;
