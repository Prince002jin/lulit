import java.sql.*;
public class ClearOtp {
  public static void main(String[] args) throws Exception {
    Class.forName("org.h2.Driver");
    try (Connection conn = DriverManager.getConnection("jdbc:h2:file:./data/lulit;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;AUTO_SERVER=TRUE", "sa", "")) {
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM otp_verifications WHERE identifier = ?")) {
        ps.setString(1, "email:lalitrani614@gmail.com");
        System.out.println(ps.executeUpdate());
      }
    }
  }
}
