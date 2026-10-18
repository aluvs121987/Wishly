-- Template: add a REAL place you have checked yourself.
-- Run in Supabase > SQL Editor after replacing every <...> value.
-- Only fill a fact if you confirmed it (phone call, message, visit or the
-- place's own website). Leave it NULL / 'unknown' otherwise: the app will then
-- show the place under "Ask before choosing" instead of guessing.
-- The database refuses pet, access, contact or coordinate facts without a
-- source and a check date.

insert into public.places (
  id, record_status, name_en, name_ar, category, kind, area, address_en, address_ar,
  lat, lng, coords_source, coords_checked_at,                 -- exact entrance location, e.g. from a site visit
  price_amount, price_basis, includes_transport, includes_taxes,
  pet_policy, pet_types, pet_restrictions_en, pet_restrictions_ar, pet_source, pet_checked_at,
  wheelchair, access_features, access_source, access_checked_at,
  contacts, contacts_source, contacts_checked_at,
  availability_en, availability_ar, availability_checked_at, tags
) values (
  '<short-id-like-maadi-cafe-1>', 'verified', '<English name>', '<الاسم بالعربي>', 'Food', 'cafe', 'Maadi',
  '<street, building, Maadi>', '<العنوان بالعربي>',
  <29.96>, <31.25>, '<how you got the coordinates>', '<2026-10-19>',
  <250>, 'per_person', 'excluded', 'unknown',                 -- price_basis: per_person | per_booking | per_item | per_visit
  'allowed', array['dog'], '<e.g. terrace only, leash required>', '<مثلاً: في التراس بس>', '<phone call with manager>', '<2026-10-19>',
  '{"step_free": true, "ramp": null, "interior": true, "ground_floor": true, "lift": null, "accessible_toilet": false}'::jsonb,
  array['stepfree'], '<site visit by Samaa>', '<2026-10-19>',
  '{"phone": "+20 2 1234 5678", "whatsapp": "201001234567", "sms": false, "website": "https://example.com", "menu": "https://example.com/menu", "social": [{"label": "Instagram", "url": "https://instagram.com/example"}]}'::jsonb,
  '<place website / phone call>', '<2026-10-19>',
  '<Daily 9 am – 11 pm>', '<يومياً ٩ص – ١١م>', '<2026-10-19 12:00+03>', array['quiet']
);

-- Optional: record what you checked, one row per fact.
insert into public.place_evidence (place_id, field, summary, source_type, source_url, checked_at)
values ('<short-id-like-maadi-cafe-1>', 'pets', '<Manager said dogs are allowed on the terrace>', 'provider_call', null, '<2026-10-19>');

-- To let yourself edit places from the app's database rules, make your account an admin
-- (find your user id in Authentication > Users):
-- insert into public.admins (user_id) values ('<your-user-uuid>');
