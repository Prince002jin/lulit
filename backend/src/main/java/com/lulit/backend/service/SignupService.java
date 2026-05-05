package com.lulit.backend.service;

import com.lulit.backend.dto.auth.AadhaarVerificationDto;
import com.lulit.backend.dto.auth.ApiMessageResponse;
import com.lulit.backend.dto.auth.CompleteSignupDto;
import com.lulit.backend.dto.auth.EmailOtpRequestDto;
import com.lulit.backend.dto.auth.PhoneOtpRequestDto;
import com.lulit.backend.dto.auth.VerifyEmailOtpDto;
import com.lulit.backend.dto.auth.VerifyPhoneOtpDto;
import com.lulit.backend.entity.SignupProgress;
import com.lulit.backend.entity.User;
import com.lulit.backend.exception.ApiException;
import com.lulit.backend.repository.SignupProgressRepository;
import com.lulit.backend.repository.UserRepository;
import com.lulit.backend.util.CryptoUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class SignupService {

    private final UserRepository userRepository;
    private final SignupProgressRepository signupProgressRepository;
    private final OtpService otpService;
    private final CryptoUtil cryptoUtil;
    private final PasswordEncoder passwordEncoder;

    @Value("${app.otp.expose-in-response:false}")
    private boolean exposeOtpInResponse;

    @Transactional
    public ApiMessageResponse requestEmailOtp(EmailOtpRequestDto request) {
        String email = request.email().trim().toLowerCase();
        if (userRepository.existsByEmail(email)) {
            throw new ApiException("Email already registered");
        }

        SignupProgress progress = signupProgressRepository.findByEmail(email).orElseGet(SignupProgress::new);
        progress.setEmail(email);
        signupProgressRepository.save(progress);

        String otp = otpService.sendOtp(emailIdentifier(email));
        return new ApiMessageResponse(exposeOtpInResponse ? "Email OTP sent: " + otp : "Email OTP sent");
    }

    @Transactional
    public ApiMessageResponse verifyEmailOtp(VerifyEmailOtpDto request) {
        String email = request.email().trim().toLowerCase();
        SignupProgress progress = signupProgressRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("Signup session not found"));

        otpService.verifyOtp(emailIdentifier(email), request.otp());
        progress.setEmailVerified(true);
        signupProgressRepository.save(progress);

        return new ApiMessageResponse("Email verified");
    }

    @Transactional
    public ApiMessageResponse requestPhoneOtp(PhoneOtpRequestDto request) {
        String email = request.email().trim().toLowerCase();
        SignupProgress progress = signupProgressRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("Signup session not found"));

        if (!Boolean.TRUE.equals(progress.getEmailVerified())) {
            throw new ApiException("Email verification is required before phone verification");
        }

        String normalizedPhone = normalizePhone(request.countryCode(), request.phoneNumber());
        if (userRepository.existsByPhone(normalizedPhone)) {
            throw new ApiException("Phone already registered");
        }
        progress.setPhone(normalizedPhone);
        signupProgressRepository.save(progress);

        String otp = otpService.sendOtp(phoneIdentifier(normalizedPhone));
        return new ApiMessageResponse(exposeOtpInResponse ? "Phone OTP sent: " + otp : "Phone OTP sent");
    }

    @Transactional
    public ApiMessageResponse verifyPhoneOtp(VerifyPhoneOtpDto request) {
        String email = request.email().trim().toLowerCase();
        SignupProgress progress = signupProgressRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("Signup session not found"));

        if (progress.getPhone() == null || progress.getPhone().isBlank()) {
            throw new ApiException("Phone must be submitted before OTP verification");
        }

        otpService.verifyOtp(phoneIdentifier(progress.getPhone()), request.otp());
        progress.setPhoneVerified(true);
        signupProgressRepository.save(progress);

        return new ApiMessageResponse("Phone verified");
    }

    @Transactional
    public ApiMessageResponse verifyAadhaar(AadhaarVerificationDto request) {
        String email = request.email().trim().toLowerCase();
        SignupProgress progress = signupProgressRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("Signup session not found"));

        if (!Boolean.TRUE.equals(progress.getEmailVerified()) || !Boolean.TRUE.equals(progress.getPhoneVerified())) {
            throw new ApiException("Email and phone must be verified before Aadhaar verification");
        }

        String aadhaar = request.aadhaarNumber().trim();
        String last4 = aadhaar.substring(aadhaar.length() - 4);
        String aadhaarHash = cryptoUtil.sha256(aadhaar);
        String encryptedHash = cryptoUtil.encryptAes(aadhaarHash);
        progress.setAadhaarLast4(last4);
        progress.setAadhaarHashEncrypted(encryptedHash);
        signupProgressRepository.save(progress);

        return new ApiMessageResponse("Aadhaar verification data securely stored");
    }

    @Transactional
    public ApiMessageResponse completeSignup(CompleteSignupDto request) {
        String email = request.email().trim().toLowerCase();
        SignupProgress progress = signupProgressRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("Signup session not found"));

        if (!Boolean.TRUE.equals(progress.getEmailVerified()) || !Boolean.TRUE.equals(progress.getPhoneVerified())) {
            throw new ApiException("Email and phone verification are required");
        }
        if (progress.getAadhaarHashEncrypted() == null || progress.getAadhaarLast4() == null) {
            throw new ApiException("Aadhaar verification is required");
        }

        String username = request.username().trim();
        if (userRepository.existsByUsername(username)) {
            throw new ApiException("Username already exists");
        }

        User user = new User();
        user.setEmail(email);
        user.setPhone(progress.getPhone());
        user.setAadhaarHashEncrypted(progress.getAadhaarHashEncrypted());
        user.setAadhaarLast4(progress.getAadhaarLast4());
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setEmailVerified(true);
        user.setPhoneVerified(true);
        userRepository.save(user);

        signupProgressRepository.delete(progress);
        return new ApiMessageResponse("Account created successfully");
    }

    private String normalizePhone(String countryCode, String phone) {
        return countryCode.trim() + phone.trim();
    }

    private String emailIdentifier(String email) {
        return "email:" + email;
    }

    private String phoneIdentifier(String phone) {
        return "phone:" + phone;
    }
}
