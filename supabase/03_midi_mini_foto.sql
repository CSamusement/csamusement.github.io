-- =====================================================================
--  03: tipo Midi, modelli divisi per tipo, fino a 20 foto, prezzo per vettura
--  Da incollare in Supabase > SQL Editor > Run
--  (si può eseguire anche più volte senza problemi)
-- =====================================================================

-- Tipo vettura sugli annunci: adulti / midi / mini
alter table public.annunci drop constraint if exists annunci_tipo_check;
alter table public.annunci add constraint annunci_tipo_check
  check (tipo in ('adulti', 'midi', 'mini'));

comment on column public.annunci.prezzo is 'Prezzo per singola vettura, in euro';

-- Ogni modello appartiene a un tipo
alter table public.modelli add column if not exists tipo text not null default 'adulti';
alter table public.modelli drop constraint if exists modelli_tipo_check;
alter table public.modelli add constraint modelli_tipo_check
  check (tipo in ('adulti', 'midi', 'mini'));

insert into public.modelli (nome, ordine, tipo) values
  ('Nuvola', 1, 'mini'), ('MiniPython', 2, 'mini')
on conflict (nome) do update set tipo = excluded.tipo;

-- Funzione di invio aggiornata (Midi + fino a 20 foto)
create or replace function public.invia_proposta(
  p_tipo            text,
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
  p_trappola        text,
  p_secondi         int
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
  -- Anti-spam (nessun IP o dato del dispositivo viene salvato)
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
  if p_tipo is null or p_tipo not in ('adulti', 'midi', 'mini') then
    raise exception 'Indica il tipo di vettura (adulti, midi o mini).';
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
  if v_n < 1 or v_n > 20 then
    raise exception 'Carica da 1 a 20 foto.';
  end if;
  if (select count(*) from storage.objects o
      where o.bucket_id = 'foto-private' and o.name = any(p_foto)
        and o.name like 'incoming/%') <> v_n
     or exists (select 1 from public.foto f where f.path_privato = any(p_foto)) then
    raise exception 'Problema con le foto caricate. Riprova.';
  end if;

  insert into public.annunci (tipo, modello_id, modello_altro, anno, quantita, condizione,
    disponibile_da, paese, prezzo, mostra_prezzo, caratteristiche, note)
  values (p_tipo, p_modello_id, nullif(trim(p_modello_altro), ''), p_anno, p_quantita, p_condizione,
    p_disponibile_da, p_paese, p_prezzo, coalesce(p_mostra_prezzo, false) and p_prezzo is not null,
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

notify pgrst, 'reload schema';
