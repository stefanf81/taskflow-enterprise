package com.example.taskflow.review;

import com.example.taskflow.core.EntityTimestampListener;
import com.example.taskflow.core.Timestamped;
import jakarta.persistence.*;
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;
import java.time.LocalDateTime;

@Entity
@Table(name = "reviews")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "l2-reviews")
@EntityListeners(EntityTimestampListener.class)
public class Review implements Timestamped {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** The reviewed appointment, referenced by id: the appointment module owns that aggregate. */
    @Column(name = "appointment_id", nullable = false, unique = true)
    private Long appointmentId;

    /** Barber of the reviewed appointment, copied when the review is written (V38). */
    @Column(name = "barber_name", nullable = false, length = 100)
    private String barberName;

    /**
     * Whether the reviewed appointment is still APPROVED, i.e. whether the review counts towards the
     * barber's rating. Kept current from the appointment events by {@link ReviewRatingInputsListener}.
     */
    @Column(nullable = false)
    private boolean counted;

    @Column(nullable = false)
    private Integer rating;

    @Column(columnDefinition = "TEXT")
    private String comment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Override
    public void markCreated(LocalDateTime now) {
        createdAt = now;
    }

    public Review() {}

    /** A review counts from the start: only APPROVED appointments can be reviewed. */
    public Review(Long appointmentId, String barberName, Integer rating, String comment) {
        this.appointmentId = appointmentId;
        this.barberName = barberName;
        this.counted = true;
        this.rating = rating;
        this.comment = comment;
    }
}
