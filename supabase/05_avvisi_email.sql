-- =====================================================================
--  05: registra quando è stato inviato l'avviso di nuova proposta
--  (evita avvisi doppi). Da incollare in Supabase > SQL Editor > Run
-- =====================================================================

alter table public.annunci add column if not exists avviso_admin_il timestamptz;

notify pgrst, 'reload schema';
