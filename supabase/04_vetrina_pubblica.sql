-- =====================================================================
--  04: "vetrina" pubblica del catalogo
--  Il pubblico NON legge più direttamente le tabelle: vede solo questa
--  vetrina, che contiene esclusivamente i dati pubblicabili.
--  Esempio: se "Mostra prezzo" non è spuntato, il prezzo non esce proprio.
--  Da incollare in Supabase > SQL Editor > Run
-- =====================================================================

create or replace view public.catalogo as
select
  a.id,
  a.codice,
  a.tipo,
  coalesce(m.nome, a.modello_altro, 'Modello') as modello,
  a.modello_id,
  a.anno,
  a.quantita,
  a.condizione,
  a.disponibile_da,
  a.paese,
  case when a.mostra_prezzo then a.prezzo end as prezzo,
  a.caratteristiche,
  a.note,
  a.stato,
  a.pubblicato_il,
  a.venduto_il,
  coalesce((
    select array_agg(f.path_pubblico order by f.ordine)
    from public.foto f
    where f.annuncio_id = a.id and f.path_pubblico is not null
  ), '{}') as foto
from public.annunci a
left join public.modelli m on m.id = a.modello_id
where a.stato in ('approvato', 'venduto');

comment on view public.catalogo is 'Vetrina pubblica: solo annunci approvati/venduti e solo dati pubblicabili';

-- Il pubblico vede solo la vetrina
grant select on public.catalogo to anon, authenticated;

-- ...e non può più leggere né toccare direttamente le tabelle interne
revoke all on public.annunci, public.foto, public.contatti_venditori, public.amministratori from anon;
revoke insert, update, delete on public.impostazioni, public.modelli, public.caratteristiche from anon;

notify pgrst, 'reload schema';
