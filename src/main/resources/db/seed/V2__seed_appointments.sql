INSERT INTO appointments (customer_name, customer_email, customer_phone, barber_name, booking_date, booking_time, service_type, status, created_at, updated_at)
VALUES 
('David Beckham', 'david@example.com', '555-0101', 'Alex the Barber', '2026-06-28', '10:00', 'Classic Haircut', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Johnny Depp', 'johnny@example.com', '555-0102', 'Sara the Stylist', '2026-06-29', '13:00', 'Beard Trim & Shave', 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Robert Downey Jr.', 'tony@example.com', '555-0199', 'Marcus Master Blade', '2026-06-24', '15:00', 'The Executive Package', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('Chris Evans', 'chris@example.com', '555-0104', 'Alex the Barber', '2026-06-24', '11:00', 'Classic Haircut', 'DENIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
