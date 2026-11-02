-- The lanes' prefix is /hub-lanes/ since 2026-10-27 (the old name stays an nginx alias of it): a kept photo's path is
-- checked against it. app.photos held no row when this ran. Applied by hand as the owner (POSTGRES_USER); idempotent.
alter table app.photos drop constraint if exists photos_path_check;
alter table app.photos add constraint photos_path_check
    check (path ~ '^/hub-lanes/photos/[a-z\-]+/[A-Za-z0-9_.\-]+/\d{8}T\d{9}Z\.(jpg|png|webp)$');
