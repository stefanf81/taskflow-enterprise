-- Provision more diverse, realistic test data for appointments and customer reviews.
-- Distributed across different barbers, services, dates, times, and statuses.

-- 1. Insert Appointments
INSERT INTO appointments (customer_name, customer_email, customer_phone, barber_name, booking_date, booking_time, service_type, status, public_id, created_at, updated_at)
VALUES 
('Keanu Reeves', 'keanu@example.com', '555-0201', 'Marcus Master Blade', '2026-06-25', '10:00', 'The Executive Package', 'APPROVED', 'seed-uuid-5', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Brad Pitt', 'brad@example.com', '555-0202', 'Alex the Barber', '2026-07-10', '09:00', 'Classic Haircut', 'APPROVED', 'seed-uuid-6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('George Clooney', 'george@example.com', '555-0203', 'Marcus Master Blade', '2026-07-11', '11:00', 'The Executive Package', 'APPROVED', 'seed-uuid-7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Leonardo DiCaprio', 'leo@example.com', '555-0204', 'Sara the Stylist', '2026-07-11', '13:00', 'Modern Skin Fade', 'APPROVED', 'seed-uuid-8', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Ryan Gosling', 'ryan@example.com', '555-0205', 'Alex the Barber', '2026-07-12', '14:00', 'Classic Haircut', 'APPROVED', 'seed-uuid-9', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Christian Bale', 'christian@example.com', '555-0206', 'Sara the Stylist', '2026-07-13', '15:00', 'Beard Trim & Shave', 'APPROVED', 'seed-uuid-10', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Tom Hardy', 'tom.hardy@example.com', '555-0207', 'Marcus Master Blade', '2026-07-14', '16:00', 'Classic Haircut', 'PENDING', 'seed-uuid-11', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Cillian Murphy', 'cillian@example.com', '555-0208', 'Alex the Barber', '2026-07-14', '09:00', 'Modern Skin Fade', 'PENDING', 'seed-uuid-12', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Hugh Jackman', 'hugh@example.com', '555-0209', 'Sara the Stylist', '2026-07-15', '10:00', 'The Executive Package', 'PENDING', 'seed-uuid-13', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Pedro Pascal', 'pedro@example.com', '555-0210', 'Alex the Barber', '2026-07-15', '11:00', 'Classic Haircut', 'PENDING', 'seed-uuid-14', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Zendaya Coleman', 'zendaya@example.com', '555-0211', 'Sara the Stylist', '2026-07-16', '13:00', 'Modern Skin Fade', 'PENDING', 'seed-uuid-15', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Scarlett Johansson', 'scarlett@example.com', '555-0212', 'Sara the Stylist', '2026-07-16', '14:00', 'Classic Haircut', 'PENDING', 'seed-uuid-16', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Chris Hemsworth', 'thor@example.com', '555-0213', 'Marcus Master Blade', '2026-07-17', '15:00', 'Beard Trim & Shave', 'DENIED', 'seed-uuid-17', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Matt Damon', 'matt@example.com', '555-0214', 'Marcus Master Blade', '2026-07-18', '16:00', 'Modern Skin Fade', 'APPROVED', 'seed-uuid-18', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Ben Affleck', 'ben@example.com', '555-0215', 'Alex the Barber', '2026-07-18', '10:00', 'Classic Haircut', 'APPROVED', 'seed-uuid-19', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Tom Cruise', 'tom.cruise@example.com', '555-0216', 'Alex the Barber', '2026-07-19', '11:00', 'Classic Haircut', 'PENDING', 'seed-uuid-20', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);


-- 2. Insert Reviews corresponding to the APPROVED appointments above
-- Utilizes subqueries to find the generated IDs of the newly added seed appointments safely in both H2 and Postgres.
INSERT INTO reviews (appointment_id, rating, comment, created_at)
VALUES 
((SELECT id FROM appointments WHERE public_id = 'seed-uuid-5'), 5, 'Incredible executive haircut and shave! Marcus is a true master of the blade.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-6'), 5, 'Quick, clean, and classic. Alex is extremely professional and polite.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-7'), 5, 'Highly recommend the Executive Package. The hot steam towel and scalp massage are heavenly.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-8'), 4, 'Excellent skin fade by Sara! She paid very close attention to details. Clean shop too.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-9'), 5, 'Always a great haircut from Alex. Clean lines and perfect styling clay selection.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-10'), 4, 'Sara did a phenomenal job sculpting my beard. Will definitely be coming back.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-18'), 5, 'Incredible service! The skin fade is sharp and the product selection is amazing.', CURRENT_TIMESTAMP),

((SELECT id FROM appointments WHERE public_id = 'seed-uuid-19'), 3, 'Decent haircut. Alex did a good job but the shop was quite busy so it felt a bit rushed.', CURRENT_TIMESTAMP);
