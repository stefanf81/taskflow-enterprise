package com.example.taskflow.auth.internal;

import com.example.taskflow.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<AppUser, Long> {

    /**
     * Case-insensitive lookup written as {@code lower(col) = lower(:email)} so PostgreSQL
     * can use the functional index from V28 (the derived {@code IgnoreCase} form generates
     * {@code upper(col) = upper(?)}, which a plain B-tree index cannot serve).
     */
    @Query("SELECT u FROM AppUser u WHERE lower(u.email) = lower(:email)")
    Optional<AppUser> findByEmailIgnoreCase(@Param("email") String email);

    /** What an access token is checked against: the account's token version and role. */
    @Query("SELECT u.tokenVersion AS tokenVersion, u.role AS role FROM AppUser u WHERE lower(u.email) = lower(:email)")
    Optional<TokenState> findTokenState(@Param("email") String email);

    /** Revokes every token of the account; returns the number of accounts changed (0 or 1). */
    @Transactional
    @Modifying
    @Query("UPDATE AppUser u SET u.tokenVersion = u.tokenVersion + 1 WHERE lower(u.email) = lower(:email)")
    int incrementTokenVersion(@Param("email") String email);

    interface TokenState {
        int getTokenVersion();

        String getRole();
    }
}
