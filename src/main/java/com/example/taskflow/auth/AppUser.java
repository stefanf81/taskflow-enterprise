package com.example.taskflow.auth;

import com.example.taskflow.core.EntityTimestampListener;
import com.example.taskflow.core.Timestamped;
import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "app_users")
@EntityListeners(EntityTimestampListener.class)
public class AppUser implements Timestamped {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "full_name", nullable = false, length = 100)
    private String fullName;

    @Column(length = 50)
    private String phone;

    @Column(nullable = false, length = 50)
    private String role; // "ROLE_ADMIN", "ROLE_CUSTOMER"

    /** Copied into every access token; raising it revokes all of them (V39, {@link AccountTokenCheck}). */
    @Column(name = "token_version", nullable = false)
    private int tokenVersion;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Override
    public void markCreated(LocalDateTime now) {
        createdAt = now;
    }

    public AppUser() {}

    public AppUser(String email, String passwordHash, String fullName, String phone, String role) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.fullName = fullName;
        this.phone = phone;
        this.role = role;
    }

    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public String getRole() { return role; }
    public int getTokenVersion() { return tokenVersion; }
}
