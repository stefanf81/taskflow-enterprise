package com.example.taskflow.auth.internal;

import com.example.taskflow.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

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
}
