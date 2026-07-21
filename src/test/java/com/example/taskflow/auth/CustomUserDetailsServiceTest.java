package com.example.taskflow.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CustomUserDetailsServiceTest {

    @Mock
    private UserRepository userRepository;

    private CustomUserDetailsService userDetailsService;

    @BeforeEach
    void setUp() {
        userDetailsService = new CustomUserDetailsService(userRepository);
    }

    @Test
    void loadUserByUsername_shouldReturnUserDetails() {
        AppUser appUser = new AppUser("test@example.com", "hashed-password", "Test User", "555-1234", "ROLE_CUSTOMER");
        when(userRepository.findByEmailIgnoreCase("test@example.com")).thenReturn(Optional.of(appUser));

        UserDetails userDetails = userDetailsService.loadUserByUsername("test@example.com");

        assertNotNull(userDetails);
        assertEquals("test@example.com", userDetails.getUsername());
        assertEquals("hashed-password", userDetails.getPassword());
        assertTrue(userDetails.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_CUSTOMER")));
    }

    @Test
    void loadUserByUsername_shouldThrowWhenNotFound() {
        when(userRepository.findByEmailIgnoreCase("unknown@example.com")).thenReturn(Optional.empty());

        assertThrows(UsernameNotFoundException.class,
                () -> userDetailsService.loadUserByUsername("unknown@example.com"));
    }

    @Test
    void loadUserByUsername_shouldBeCaseInsensitive() {
        AppUser appUser = new AppUser("Mixed@Example.com", "pwd", "Mixed", null, "ROLE_ADMIN");
        when(userRepository.findByEmailIgnoreCase("MIXED@EXAMPLE.COM")).thenReturn(Optional.of(appUser));

        UserDetails userDetails = userDetailsService.loadUserByUsername("MIXED@EXAMPLE.COM");

        assertNotNull(userDetails);
        assertEquals("Mixed@Example.com", userDetails.getUsername());
    }

    @Test
    void loadUserByUsername_shouldContainProperlyAuthorities() {
        AppUser adminUser = new AppUser("admin@example.com", "hash", "Admin", null, "ROLE_ADMIN");
        when(userRepository.findByEmailIgnoreCase("admin@example.com")).thenReturn(Optional.of(adminUser));

        UserDetails userDetails = userDetailsService.loadUserByUsername("admin@example.com");

        assertEquals(1, userDetails.getAuthorities().size());
        assertEquals("ROLE_ADMIN", userDetails.getAuthorities().iterator().next().getAuthority());
    }
}
