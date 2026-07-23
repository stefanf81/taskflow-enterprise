package com.example.taskflow.appointment;

/**
 * Output DTO for barber listing endpoints. Used in two ways:
 * <ol>
 *   <li><b>Entity mapping</b> — constructed manually from a {@link Barber} entity</li>
 *   <li><b>JPQL DTO projection</b> — returned directly by a constructor-expression query,
 *       bypassing entity loading entirely</li>
 * </ol>
 *
 * @param id    the barber's primary key
 * @param name  the barber's display name
 * @param email the barber's email
 * @param phone the barber's phone number
 */
public record BarberResponse(Long id, String name, String email, String phone) {

    /**
     * Factory method: create a {@code BarberResponse} from a fully loaded {@link Barber} entity.
     * Used by the current entity-based code path.
     */
    public static BarberResponse fromEntity(Barber barber) {
        return new BarberResponse(
                barber.getId(),
                barber.getName(),
                barber.getEmail(),
                barber.getPhone()
        );
    }
}
