-- =====================================================================
--  Tostones Multi · base de datos (PostgreSQL / Supabase)
--
--  Varias fábricas (empresas) comparten la misma base de datos.
--  Cada fila lleva su empresa_id y las políticas de seguridad (RLS)
--  hacen que cada usuario solo vea y cambie los datos de las empresas
--  de las que es miembro.
--
--  Cómo usarlo: en Supabase abre "SQL Editor", pega todo este archivo
--  y presiona "Run". Se puede volver a correr sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Empresas y usuarios
-- ---------------------------------------------------------------------

do $$ begin
  create type rol_miembro as enum ('dueno', 'admin', 'operador');
exception when duplicate_object then null; end $$;

create table if not exists empresas (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null check (length(trim(nombre)) > 0),
  moneda  text not null default '$',
  dias_aviso int not null default 7 check (dias_aviso >= 0),
  creado  timestamptz not null default now()
);

create table if not exists miembros (
  empresa_id uuid not null references empresas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null,
  rol        rol_miembro not null default 'operador',
  creado     timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index if not exists miembros_user_idx on miembros(user_id);

-- Correos invitados a una empresa: entran solos la primera vez que inician sesión
create table if not exists invitaciones (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  email      text not null check (email = lower(trim(email)) and email like '%@%'),
  rol        rol_miembro not null default 'operador' check (rol <> 'dueno'),
  creado     timestamptz not null default now(),
  unique (empresa_id, email)
);

-- ---------------------------------------------------------------------
--  Catálogos
-- ---------------------------------------------------------------------

create table if not exists tipos_toston (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  precio     numeric(12,2) not null default 0 check (precio >= 0),
  activo     boolean not null default true,
  creado     timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (id, empresa_id)
);

create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  telefono   text,
  notas      text,
  recordar   boolean not null default true,  -- avisar si debe por más de "dias_aviso" días
  creado     timestamptz not null default now(),
  unique (id, empresa_id)
);
create index if not exists clientes_empresa_idx on clientes(empresa_id);

-- ---------------------------------------------------------------------
--  Gastos (materia prima, producción y otros)
--  "grupo" es el código que une los gastos de una misma producción.
-- ---------------------------------------------------------------------

create table if not exists gastos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  fecha       date not null default current_date,
  tipo        text not null default 'Materia prima' check (tipo in ('Materia prima', 'Producción', 'Otro')),
  descripcion text not null check (length(trim(descripcion)) > 0),
  cantidad    numeric(12,3) check (cantidad is null or cantidad >= 0),
  unidad      text,
  monto       numeric(12,2) not null check (monto >= 0),
  proveedor   text,
  grupo       text check (grupo is null or grupo = upper(trim(grupo))),
  creado      timestamptz not null default now()
);
create index if not exists gastos_empresa_fecha_idx on gastos(empresa_id, fecha);
create index if not exists gastos_grupo_idx on gastos(empresa_id, grupo) where grupo is not null;

-- ---------------------------------------------------------------------
--  Producción: una producción tiene varios tipos de tostón
-- ---------------------------------------------------------------------

create table if not exists producciones (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  fecha      date not null default current_date,
  grupo      text check (grupo is null or grupo = upper(trim(grupo))),
  costo      numeric(12,2) not null default 0 check (costo >= 0), -- se usa si no hay grupo de gastos
  nota       text,
  creado     timestamptz not null default now(),
  unique (id, empresa_id)
);
create index if not exists producciones_empresa_fecha_idx on producciones(empresa_id, fecha);

create table if not exists produccion_items (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null,
  produccion_id uuid not null,
  tipo_id       uuid not null,
  cantidad      numeric(12,3) not null check (cantidad > 0),
  precio        numeric(12,2) not null default 0 check (precio >= 0), -- precio de venta esperado
  foreign key (produccion_id, empresa_id) references producciones(id, empresa_id) on delete cascade,
  foreign key (tipo_id, empresa_id) references tipos_toston(id, empresa_id)
);
create index if not exists produccion_items_prod_idx on produccion_items(produccion_id);
create index if not exists produccion_items_tipo_idx on produccion_items(tipo_id);

-- ---------------------------------------------------------------------
--  Ventas, sus líneas y pagos de clientes
-- ---------------------------------------------------------------------

create table if not exists ventas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  fecha      date not null default current_date,
  cliente_id uuid,                    -- vacío = cliente general (de contado)
  pagado     numeric(12,2) not null default 0 check (pagado >= 0),
  creado     timestamptz not null default now(),
  unique (id, empresa_id),
  foreign key (cliente_id, empresa_id) references clientes(id, empresa_id) on delete set null (cliente_id)
);
create index if not exists ventas_empresa_fecha_idx on ventas(empresa_id, fecha);
create index if not exists ventas_cliente_idx on ventas(cliente_id);

create table if not exists venta_items (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  venta_id   uuid not null,
  tipo_id    uuid not null,
  cantidad   numeric(12,3) not null check (cantidad > 0),
  precio     numeric(12,2) not null check (precio >= 0),
  foreign key (venta_id, empresa_id) references ventas(id, empresa_id) on delete cascade,
  foreign key (tipo_id, empresa_id) references tipos_toston(id, empresa_id)
);
create index if not exists venta_items_venta_idx on venta_items(venta_id);
create index if not exists venta_items_tipo_idx on venta_items(tipo_id);

create table if not exists pagos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  cliente_id uuid not null,
  fecha      date not null default current_date,
  monto      numeric(12,2) not null check (monto > 0),
  creado     timestamptz not null default now(),
  foreign key (cliente_id, empresa_id) references clientes(id, empresa_id) on delete cascade
);
create index if not exists pagos_empresa_fecha_idx on pagos(empresa_id, fecha);
create index if not exists pagos_cliente_idx on pagos(cliente_id);

-- ---------------------------------------------------------------------
--  Permisos: quién es miembro de qué empresa
-- ---------------------------------------------------------------------

create or replace function es_miembro(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where empresa_id = e and user_id = auth.uid())
$$;

create or replace function es_admin(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where empresa_id = e and user_id = auth.uid() and rol in ('dueno', 'admin'))
$$;

create or replace function es_dueno(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where empresa_id = e and user_id = auth.uid() and rol = 'dueno')
$$;

alter table empresas         enable row level security;
alter table miembros         enable row level security;
alter table invitaciones     enable row level security;
alter table tipos_toston     enable row level security;
alter table clientes         enable row level security;
alter table gastos           enable row level security;
alter table producciones     enable row level security;
alter table produccion_items enable row level security;
alter table ventas           enable row level security;
alter table venta_items      enable row level security;
alter table pagos            enable row level security;

-- Empresas: los miembros la ven, los administradores cambian nombre y moneda, solo el dueño la borra.
-- Se crean con la función crear_empresa().
drop policy if exists empresas_ver on empresas;
create policy empresas_ver on empresas for select using (es_miembro(id));
drop policy if exists empresas_editar on empresas;
create policy empresas_editar on empresas for update using (es_admin(id)) with check (es_admin(id));
drop policy if exists empresas_borrar on empresas;
create policy empresas_borrar on empresas for delete using (es_dueno(id));

-- Miembros: todos ven al equipo; los administradores cambian roles y sacan gente (nunca al dueño);
-- cualquiera puede salirse de una empresa que no es suya.
drop policy if exists miembros_ver on miembros;
create policy miembros_ver on miembros for select using (es_miembro(empresa_id));
drop policy if exists miembros_editar on miembros;
create policy miembros_editar on miembros for update
  using (es_admin(empresa_id) and rol <> 'dueno')
  with check (es_admin(empresa_id) and rol <> 'dueno');
drop policy if exists miembros_borrar on miembros;
create policy miembros_borrar on miembros for delete
  using (rol <> 'dueno' and (es_admin(empresa_id) or user_id = auth.uid()));

drop policy if exists invitaciones_admin on invitaciones;
create policy invitaciones_admin on invitaciones for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Datos de trabajo: cualquier miembro de la empresa los ve y los cambia.
do $$
declare t text;
begin
  foreach t in array array['tipos_toston','clientes','gastos','producciones','produccion_items','ventas','venta_items','pagos'] loop
    execute format('drop policy if exists %I on %I', t || '_miembros', t);
    execute format('create policy %I on %I for all using (es_miembro(empresa_id)) with check (es_miembro(empresa_id))', t || '_miembros', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Vistas (respetan los permisos de quien consulta)
-- ---------------------------------------------------------------------

-- Cada venta con su total y lo que quedó pendiente
create or replace view v_ventas with (security_invoker = true) as
select v.id, v.empresa_id, v.fecha, v.cliente_id, c.nombre as cliente,
       coalesce(sum(i.cantidad * i.precio), 0)::numeric(12,2) as total,
       v.pagado,
       (coalesce(sum(i.cantidad * i.precio), 0) - v.pagado)::numeric(12,2) as pendiente
from ventas v
left join venta_items i on i.venta_id = v.id
left join clientes c on c.id = v.cliente_id
group by v.id, c.nombre;

-- Cuánto debe cada cliente (ventas menos lo pagado en la venta y los pagos después)
create or replace view v_saldo_clientes with (security_invoker = true) as
select c.id, c.empresa_id, c.nombre, c.telefono,
       coalesce(vv.total, 0) as comprado,
       coalesce(vv.pagado, 0) + coalesce(pp.pagos, 0) as pagado,
       (coalesce(vv.pendiente, 0) - coalesce(pp.pagos, 0))::numeric(12,2) as deuda
from clientes c
left join (select cliente_id, sum(total) total, sum(pagado) pagado, sum(pendiente) pendiente
           from v_ventas group by cliente_id) vv on vv.cliente_id = c.id
left join (select cliente_id, sum(monto) pagos from pagos group by cliente_id) pp on pp.cliente_id = c.id;

-- Existencias: lo producido menos lo vendido de cada tipo de tostón
create or replace view v_inventario with (security_invoker = true) as
select t.id as tipo_id, t.empresa_id, t.nombre, t.precio, t.activo,
       coalesce(p.cant, 0) as producidas,
       coalesce(s.cant, 0) as vendidas,
       coalesce(p.cant, 0) - coalesce(s.cant, 0) as existencia
from tipos_toston t
left join (select tipo_id, sum(cantidad) cant from produccion_items group by tipo_id) p on p.tipo_id = t.id
left join (select tipo_id, sum(cantidad) cant from venta_items group by tipo_id) s on s.tipo_id = t.id;

-- Grupos de gastos con su total
create or replace view v_grupos_gasto with (security_invoker = true) as
select empresa_id, grupo, count(*) as gastos, sum(monto)::numeric(12,2) as total, max(fecha) as ultima_fecha
from gastos where grupo is not null
group by empresa_id, grupo;

-- ---------------------------------------------------------------------
--  Funciones que usa la aplicación
-- ---------------------------------------------------------------------

-- Crea una empresa nueva y deja como dueño a quien la crea
create or replace function crear_empresa(p_nombre text, p_moneda text default '$') returns uuid
language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero' using errcode = '42501'; end if;
  insert into empresas(nombre, moneda) values (trim(p_nombre), coalesce(nullif(trim(p_moneda), ''), '$')) returning id into e;
  insert into miembros(empresa_id, user_id, email, rol)
    values (e, auth.uid(), lower(coalesce(auth.jwt() ->> 'email', '')), 'dueno');
  return e;
end $$;

-- Une al usuario a las empresas que lo invitaron por correo
create or replace function aceptar_invitaciones() returns int
language plpgsql security definer set search_path = public as $$
declare n int; correo text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or correo is null then return 0; end if;
  insert into miembros(empresa_id, user_id, email, rol)
    select empresa_id, auth.uid(), correo, rol from invitaciones where email = correo
    on conflict (empresa_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from invitaciones where email = correo;
  return n;
end $$;

-- Guarda una venta con todas sus líneas de una sola vez (nueva o editada)
create or replace function guardar_venta(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare e uuid := (p ->> 'empresa_id')::uuid; v uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not es_miembro(e) then raise exception 'No tienes acceso a esta empresa' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then raise exception 'La venta no tiene tostones'; end if;
  if v is null then
    insert into ventas(empresa_id, fecha, cliente_id, pagado)
      values (e, coalesce((p ->> 'fecha')::date, current_date), nullif(p ->> 'cliente_id', '')::uuid, coalesce((p ->> 'pagado')::numeric, 0))
      returning id into v;
  else
    update ventas set fecha = coalesce((p ->> 'fecha')::date, fecha), cliente_id = nullif(p ->> 'cliente_id', '')::uuid,
                      pagado = coalesce((p ->> 'pagado')::numeric, 0)
      where id = v and empresa_id = e;
    if not found then raise exception 'No se encontró la venta'; end if;
    delete from venta_items where venta_id = v;
  end if;
  insert into venta_items(empresa_id, venta_id, tipo_id, cantidad, precio)
    select e, v, (i ->> 'tipo_id')::uuid, (i ->> 'cantidad')::numeric, coalesce((i ->> 'precio')::numeric, 0)
    from jsonb_array_elements(p -> 'items') i;
  return v;
end $$;

-- Guarda una producción con todos sus tipos de tostón de una sola vez (nueva o editada)
create or replace function guardar_produccion(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare e uuid := (p ->> 'empresa_id')::uuid; r uuid := nullif(p ->> 'id', '')::uuid;
        g text := nullif(upper(trim(p ->> 'grupo')), '');
begin
  if not es_miembro(e) then raise exception 'No tienes acceso a esta empresa' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then raise exception 'La producción no tiene tostones'; end if;
  if r is null then
    insert into producciones(empresa_id, fecha, grupo, costo, nota)
      values (e, coalesce((p ->> 'fecha')::date, current_date), g, coalesce((p ->> 'costo')::numeric, 0), nullif(p ->> 'nota', ''))
      returning id into r;
  else
    update producciones set fecha = coalesce((p ->> 'fecha')::date, fecha), grupo = g,
                            costo = coalesce((p ->> 'costo')::numeric, 0), nota = nullif(p ->> 'nota', '')
      where id = r and empresa_id = e;
    if not found then raise exception 'No se encontró la producción'; end if;
    delete from produccion_items where produccion_id = r;
  end if;
  insert into produccion_items(empresa_id, produccion_id, tipo_id, cantidad, precio)
    select e, r, (i ->> 'tipo_id')::uuid, (i ->> 'cantidad')::numeric, coalesce((i ->> 'precio')::numeric, 0)
    from jsonb_array_elements(p -> 'items') i;
  return r;
end $$;

-- ---------------------------------------------------------------------
--  Acceso desde la aplicación (solo usuarios con sesión iniciada)
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
