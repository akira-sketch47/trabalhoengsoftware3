create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('candidate', 'company')),
  nome text not null check (char_length(nome) between 1 and 120),
  email text not null,
  tel text check (tel is null or char_length(tel) <= 30),
  cidade text check (cidade is null or char_length(cidade) <= 100),
  area text check (area is null or char_length(area) <= 60),
  esc text check (esc is null or char_length(esc) <= 60),
  sobre text check (sobre is null or char_length(sobre) <= 2000),
  cnpj text check (cnpj is null or char_length(cnpj) <= 18),
  setor text check (setor is null or char_length(setor) <= 60),
  resp text check (resp is null or char_length(resp) <= 120),
  "desc" text check ("desc" is null or char_length("desc") <= 2000),
  headline text check (headline is null or char_length(headline) <= 120),
  skills text[] not null default '{}',
  link text check (link is null or char_length(link) <= 300),
  avatar text check (avatar is null or char_length(avatar) <= 150000),
  color text check (color is null or char_length(color) <= 9),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists headline text check (headline is null or char_length(headline) <= 120);
alter table public.profiles add column if not exists skills text[] not null default '{}';
alter table public.profiles add column if not exists link text check (link is null or char_length(link) <= 300);
alter table public.profiles add column if not exists avatar text check (avatar is null or char_length(avatar) <= 150000);
alter table public.profiles add column if not exists color text check (color is null or char_length(color) <= 9);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.profiles (id) on delete cascade,
  company_name text not null check (char_length(company_name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 120),
  area text not null check (char_length(area) <= 60),
  city text not null check (char_length(city) between 1 and 100),
  mode text not null check (mode in ('Presencial', 'Híbrido', 'Remoto')),
  employment_type text not null check (employment_type in ('CLT', 'PJ', 'Estágio', 'Temporário')),
  salary text not null default '' check (char_length(salary) <= 80),
  description text not null check (char_length(description) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.saved_jobs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  candidate_name text not null check (char_length(candidate_name) between 1 and 120),
  candidate_email text not null,
  created_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create index if not exists jobs_status_created_at_idx
  on public.jobs (status, created_at desc);
create index if not exists jobs_company_id_idx on public.jobs (company_id);
create index if not exists applications_candidate_id_idx on public.applications (candidate_id);
create index if not exists applications_job_id_idx on public.applications (job_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := new.raw_user_meta_data;
begin
  insert into public.profiles (
    id, role, nome, email, tel, cidade, area, esc, sobre,
    cnpj, setor, resp, "desc", headline, skills, link, avatar, color
  ) values (
    new.id,
    case when metadata ->> 'role' = 'company' then 'company' else 'candidate' end,
    coalesce(nullif(metadata ->> 'nome', ''), split_part(new.email, '@', 1)),
    new.email,
    metadata ->> 'tel',
    metadata ->> 'cidade',
    metadata ->> 'area',
    metadata ->> 'esc',
    metadata ->> 'sobre',
    metadata ->> 'cnpj',
    metadata ->> 'setor',
    metadata ->> 'resp',
    metadata ->> 'desc',
    metadata ->> 'headline',
    coalesce(array(select jsonb_array_elements_text(coalesce(metadata -> 'skills', '[]'::jsonb))), '{}'),
    metadata ->> 'link',
    metadata ->> 'avatar',
    metadata ->> 'color'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.saved_jobs enable row level security;
alter table public.applications enable row level security;

grant select on public.profiles to authenticated;
grant update (nome, tel, cidade, area, esc, sobre, cnpj, setor, resp, "desc", headline, skills, link, avatar, color, updated_at)
  on public.profiles to authenticated;
grant select on public.jobs to anon, authenticated;
grant insert, update, delete on public.jobs to authenticated;
grant select, insert, delete on public.saved_jobs to authenticated;
grant select, insert, delete on public.applications to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Anyone can read open jobs" on public.jobs;
create policy "Anyone can read open jobs"
  on public.jobs for select to anon, authenticated
  using (status = 'open' or company_id = (select auth.uid()));

drop policy if exists "Companies can publish jobs" on public.jobs;
create policy "Companies can publish jobs"
  on public.jobs for insert to authenticated
  with check (
    company_id = (select auth.uid())
    and company_name = (
      select nome from public.profiles where id = (select auth.uid())
    )
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'company'
    )
  );

drop policy if exists "Companies can update their jobs" on public.jobs;
create policy "Companies can update their jobs"
  on public.jobs for update to authenticated
  using (
    company_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'company'
    )
  )
  with check (
    company_id = (select auth.uid())
    and company_name = (
      select nome from public.profiles where id = (select auth.uid())
    )
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'company'
    )
  );

drop policy if exists "Companies can delete their jobs" on public.jobs;
create policy "Companies can delete their jobs"
  on public.jobs for delete to authenticated
  using (
    company_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'company'
    )
  );

drop policy if exists "Users can read their saved jobs" on public.saved_jobs;
create policy "Users can read their saved jobs"
  on public.saved_jobs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can save jobs for themselves" on public.saved_jobs;
create policy "Users can save jobs for themselves"
  on public.saved_jobs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.jobs where id = job_id and status = 'open')
  );

drop policy if exists "Users can remove their saved jobs" on public.saved_jobs;
create policy "Users can remove their saved jobs"
  on public.saved_jobs for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Candidates and job owners can read applications" on public.applications;
create policy "Candidates and job owners can read applications"
  on public.applications for select to authenticated
  using (
    candidate_id = (select auth.uid())
    or exists (
      select 1 from public.jobs
      where jobs.id = applications.job_id
        and jobs.company_id = (select auth.uid())
    )
  );

drop policy if exists "Candidates can apply to open jobs" on public.applications;
create policy "Candidates can apply to open jobs"
  on public.applications for insert to authenticated
  with check (
    candidate_id = (select auth.uid())
    and candidate_name = (
      select nome from public.profiles where id = (select auth.uid())
    )
    and candidate_email = (select auth.jwt() ->> 'email')
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'candidate'
    )
    and exists (
      select 1 from public.jobs
      where jobs.id = job_id and jobs.status = 'open'
    )
  );

drop policy if exists "Candidates can withdraw their applications" on public.applications;
create policy "Candidates can withdraw their applications"
  on public.applications for delete to authenticated
  using (candidate_id = (select auth.uid()));
