-- T8: Supporting index for the public reviews listing / average-rating query.
-- The customer portal renders recent reviews sorted by rating then recency and
-- computes an average rating. A composite (rating, created_at) index lets the
-- "top-rated, newest first" query avoid a full scan and supports the aggregate
-- grouping. CREATE INDEX IF NOT EXISTS is supported by H2 and PostgreSQL and
-- makes this migration safe to re-apply.
CREATE INDEX IF NOT EXISTS idx_reviews_rating_created ON reviews (rating, created_at);
