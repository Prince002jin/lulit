package com.lulit.backend.config;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;

@Component
public class SecurityConfigValidator {

    private static final String INSECURE_AES_DEFAULT = "0123456789abcdef0123456789abcdef";
    private static final String INSECURE_JWT_DEFAULT = "VGhpc0lzQVN1ZmZpY2llbnRseUxvbmdCYXNlNjRTZWNyZXRLZXlGb3JMVUxJVA==";

    private final Environment environment;

    @Value("${app.security.aes-key}")
    private String aesKey;

    @Value("${app.security.jwt-secret}")
    private String jwtSecretBase64;

    public SecurityConfigValidator(Environment environment) {
        this.environment = environment;
    }

    @PostConstruct
    public void validateSecuritySecretsForProd() {
        boolean prodProfileActive = Arrays.stream(environment.getActiveProfiles())
                .anyMatch("prod"::equalsIgnoreCase);
        if (!prodProfileActive) {
            return;
        }

        if (INSECURE_AES_DEFAULT.equals(aesKey)) {
            throw new IllegalStateException("Insecure default AES_KEY is not allowed in prod profile.");
        }
        if (INSECURE_JWT_DEFAULT.equals(jwtSecretBase64)) {
            throw new IllegalStateException("Insecure default JWT_SECRET_BASE64 is not allowed in prod profile.");
        }
    }
}
