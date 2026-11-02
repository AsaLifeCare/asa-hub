-- Client training (IST) bookings: every training booked in My Work's panel and approved there by a director or above
-- (app/ist_bookings.py, app/my_work_writes.py). The Hub's database alone keeps them: no sheet holds a booking. One
-- waiting booking per IST record; a write the relay voids takes its booking or its approval back (write_id,
-- approve_write_id).
-- Applied by hand as the owner (POSTGRES_USER); idempotent. asa-hub-app writes it (asa_hub_app_rw) and reads it
-- (asa_hub_app_ro).
set role asa_hub_app_rw;

create table if not exists app.ist_bookings (
    id                text primary key check (id ~ '^IB[0-9a-f]{10}$'),
    ist_id            text not null check (ist_id <> ''),
    house             text not null default '',
    client_name       text not null default '',
    staff_name        text not null default '',
    staff_email       text not null default '',
    training_date     date not null,
    answer            text not null check (answer in ('confirmed', 'declined')),
    note              text not null default '',
    state             text not null default 'waiting' check (state in ('waiting', 'approved')),
    booked_by_uid     text not null default '',
    booked_by_name    text not null default '',
    booked_at         timestamptz not null default now(),
    approved_by_uid   text not null default '',
    approved_by_name  text not null default '',
    approved_at       timestamptz,
    write_id          text not null default '',
    approve_write_id  text not null default ''
);
create index if not exists ist_bookings_ist on app.ist_bookings (ist_id, booked_at desc);
create unique index if not exists ist_bookings_one_waiting on app.ist_bookings (ist_id) where state = 'waiting';

grant select on app.ist_bookings to asa_hub_app_ro;
reset role;
