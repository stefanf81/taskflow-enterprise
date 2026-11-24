-- The promo strip at the top of both landing pages, edited by the owner. One row (id = 1); a NULL
-- message means no strip. 120 characters keep it to three lines on a phone, two on a tablet and
-- one on a desktop: the prerendered web page reserves exactly that much room before it is known.
-- Seeded with the text both clients used to hard-code.
CREATE TABLE shop_announcement (
    id SMALLINT PRIMARY KEY,
    message VARCHAR(120),
    CONSTRAINT ck_shop_announcement_single_row CHECK (id = 1)
);

INSERT INTO shop_announcement (id, message) VALUES
(1, 'Special Highlight: Book ''The Executive Package'' today and get 15% off any premium hair styling clay!');
