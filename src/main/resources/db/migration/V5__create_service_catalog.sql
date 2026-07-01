CREATE TABLE services (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    category VARCHAR(50) NOT NULL,
    description VARCHAR(500)
);

INSERT INTO services (name, price, duration_minutes, category, description) VALUES
('Classic Haircut', 25.00, 30, 'hair', 'Precision cut tailored to your head shape, complete with razor neck cleanup and premium styling.'),
('Modern Skin Fade', 30.00, 45, 'hair', 'Sleek blended skin fade with a crisp straight razor lineup and clay texturization.'),
('Beard Trim & Shave', 18.00, 25, 'beard', 'Detail beard lineup, hot steam towel treatment, aromatic pre-shave oil massage, and soothing trim.'),
('Royal Hot Towel Shave', 22.00, 30, 'beard', 'Traditional lather shaving using a straight razor blade, three rounds of steam towels, and cold-balm massage.'),
('The Executive Package', 40.00, 60, 'combo', 'The ultimate royal experience: Classic Haircut, full Beard Shave, facial wash, and essential-oil head massage.');
