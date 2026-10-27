package com.example.taskflow.review;

import jakarta.persistence.*;
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;
import java.time.LocalDateTime;

@Entity
@Table(name = "reviews")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "l2-reviews")
public class Review {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** The reviewed appointment, referenced by id: the appointment module owns that aggregate. */
    @Column(name = "appointment_id", nullable = false, unique = true)
    private Long appointmentId;

    @Column(nullable = false)
    private Integer rating;

    @Column(columnDefinition = "TEXT")
    private String comment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    public Review() {}

    public Review(Long appointmentId, Integer rating, String comment) {
        this.appointmentId = appointmentId;
        this.rating = rating;
        this.comment = comment;
    }
}
