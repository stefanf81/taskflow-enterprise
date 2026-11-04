package com.example.taskflow.auth.internal;

import com.example.taskflow.auth.RevokedToken;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Repository
public interface RevokedTokenRepository extends JpaRepository<RevokedToken, String> {

    /** Revocations of tokens that have not expired yet, the longest-lived first. */
    @Query("SELECT r FROM RevokedToken r WHERE r.expiresAt > :now ORDER BY r.expiresAt DESC")
    List<RevokedToken> findActive(@Param("now") Instant now, Pageable page);

    /** Retention: the token is rejected by its own expiry from then on. Returns the rows deleted. */
    @Transactional
    @Modifying
    @Query("DELETE FROM RevokedToken r WHERE r.expiresAt <= :now")
    int deleteExpired(@Param("now") Instant now);
}
