-- Remove only the obsolete direct-SQL superadmin seed. It owns no business
-- rows and has been replaced by the SUPERADMIN_SECRET session endpoint.
delete from auth.users
where id = '11111111-1111-1111-1111-111111111111'
  and email = 'admin@saloniq.com';
