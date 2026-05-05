package com.lulit.backend.service;

import com.lulit.backend.entity.OtpVerification;
import com.lulit.backend.exception.ApiException;
import com.lulit.backend.repository.OtpVerificationRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class OtpService {

    private static final Logger logger = LoggerFactory.getLogger(OtpService.class);
    private static final int OTP_EXPIRY_MINUTES = 5;
    private static final int MAX_ATTEMPTS = 5;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final OtpVerificationRepository otpVerificationRepository;
    private final PasswordEncoder passwordEncoder;
    private final OtpDeliveryService otpDeliveryService;

    @Transactional
    public String sendOtp(String identifier) {
        OtpVerification existing = otpVerificationRepository.findByIdentifier(identifier).orElse(null);
        LocalDateTime now = LocalDateTime.now();

        if (existing != null && Boolean.FALSE.equals(existing.getVerified()) && existing.getExpiresAt().isAfter(now.minusSeconds(30))) {
            throw new ApiException("Please wait before requesting another OTP");
        }

        String rawOtp = String.format("%06d", SECURE_RANDOM.nextInt(1_000_000));
        String encodedOtp = passwordEncoder.encode(rawOtp);

        OtpVerification otp = existing != null ? existing : new OtpVerification();
        otp.setIdentifier(identifier);
        otp.setOtp(encodedOtp);
        otp.setExpiresAt(now.plusMinutes(OTP_EXPIRY_MINUTES));
        otp.setAttemptCount(0);
        otp.setVerified(false);
        otpVerificationRepository.save(otp);

        try {
            otpDeliveryService.deliverOtp(identifier, rawOtp);
        } catch (IllegalStateException ex) {
            logger.warn("OTP delivery failed for {}: {}", identifier, ex.getMessage());
            throw new ApiException("Failed to deliver OTP. Please try again.");
        }

        return rawOtp;
    }

    @Transactional
    public void verifyOtp(String identifier, String otp) {
        OtpVerification otpVerification = otpVerificationRepository.findByIdentifier(identifier)
                .orElseThrow(() -> new ApiException("OTP not found for identifier"));

        if (Boolean.TRUE.equals(otpVerification.getVerified())) {
            throw new ApiException("OTP already verified");
        }
        if (otpVerification.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new ApiException("OTP expired");
        }
        if (otpVerification.getAttemptCount() >= MAX_ATTEMPTS) {
            throw new ApiException("Maximum OTP verification attempts exceeded");
        }
        if (!passwordEncoder.matches(otp, otpVerification.getOtp())) {
            otpVerification.setAttemptCount(otpVerification.getAttemptCount() + 1);
            otpVerificationRepository.save(otpVerification);
            throw new ApiException("Invalid OTP");
        }

        otpVerification.setVerified(true);
        otpVerificationRepository.save(otpVerification);
    }
}
