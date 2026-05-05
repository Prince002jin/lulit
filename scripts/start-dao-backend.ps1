$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$mvn = "C:\Users\lalit\Downloads\apache-maven-3.9.10-bin\apache-maven-3.9.10\bin\mvn.cmd"
$log = Join-Path $root "backend-dao-run.log"

$command = @(
  "set AI_ENABLED=true",
  "set AI_EMBEDDING_ENDPOINT=http://127.0.0.1:9000/embedding",
  "set AI_MODERATION_ENDPOINT=http://127.0.0.1:9000/moderation",
  "set AI_SUMMARY_ENDPOINT=http://127.0.0.1:9000/summary",
  "set DAO_ENABLED=true",
  "set DAO_RPC_URL=http://127.0.0.1:8545",
  "set DAO_TOKEN_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "set DAO_GOVERNANCE_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "set DAO_TREASURY_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "set OTP_EMAIL_PROVIDER=console",
  "set OTP_SMS_PROVIDER=console",
  "set OTP_EXPOSE_IN_RESPONSE=true",
  "set COOKIE_SECURE=false",
  "cd /d `"$backend`"",
  "`"$mvn`" spring-boot:run > `"$log`" 2>&1"
) -join " && "

Start-Process cmd.exe -ArgumentList "/c $command" -WindowStyle Hidden
