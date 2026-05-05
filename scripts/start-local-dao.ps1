param(
  [switch]$Redeploy
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "run-logs"
$smart = Join-Path $root "smart-contract"
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$aiService = Join-Path $root "ai-service"
$deployFile = Join-Path $smart "deployment\dao-localhost.json"

New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Get-ListenerPid($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return $conn.OwningProcess }
  return $null
}

function Wait-ForPort($port, $timeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Get-ListenerPid $port) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return [bool](Get-ListenerPid $port)
}

function Start-HardhatNode {
  $listenerPid = Get-ListenerPid 8545
  if (-not $listenerPid) {
    Write-Host "Starting Hardhat node on 8545..."
    Start-Process cmd.exe -ArgumentList "/c", "cd /d `"$smart`" && npx hardhat node 1> `"$logs\hardhat.out.log`" 2> `"$logs\hardhat.err.log`"" -WindowStyle Hidden
    Start-Sleep -Seconds 4
  } else {
    Write-Host "Hardhat node already running (PID $listenerPid)"
  }
}

function Deploy-Dao {
  $needsDeploy = $Redeploy -or -not (Test-Path $deployFile)
  if (-not $needsDeploy) {
    try {
      $existing = Get-Content $deployFile | ConvertFrom-Json
      $rpcBody = '{"jsonrpc":"2.0","method":"eth_getCode","params":["' + $existing.dao + '","latest"],"id":1}'
      $rpcResp = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8545" -ContentType "application/json" -Body $rpcBody
      if (-not $rpcResp.result -or $rpcResp.result -eq "0x") {
        Write-Host "Deployment file exists but DAO code missing on chain. Redeploying..."
        $needsDeploy = $true
      }
    } catch {
      Write-Host "Could not validate existing deployment. Redeploying..."
      $needsDeploy = $true
    }
  }

  if ($needsDeploy) {
    Write-Host "Deploying DAO contracts to localhost..."
    & cmd.exe /c "cd /d `"$smart`" && npx hardhat run scripts/deploy-dao.js --network localhost"
  } else {
    Write-Host "Using existing deployment file: $deployFile"
  }
  return Get-Content $deployFile | ConvertFrom-Json
}

function Write-FrontendEnv($deployment) {
  $envContent = @"
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_DAO_GOVERNANCE_ADDRESS=$($deployment.dao)
VITE_DAO_TOKEN_ADDRESS=$($deployment.token)
VITE_DAO_TREASURY_ADDRESS=$($deployment.treasury)
"@
  Set-Content -Path (Join-Path $frontend ".env") -Value $envContent
}

function Restart-Frontend {
  $listenerPid = Get-ListenerPid 5173
  if ($listenerPid) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Starting frontend on 5173..."
  Start-Process cmd.exe -ArgumentList "/c", "cd /d `"$frontend`" && npm run dev -- --host 0.0.0.0 --port 5173 1> `"$logs\frontend.out.log`" 2> `"$logs\frontend.err.log`"" -WindowStyle Hidden
}

function Restart-AiService {
  $listenerPid = Get-ListenerPid 9000
  if ($listenerPid) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path (Join-Path $aiService "main.py"))) {
    Write-Host "AI service not found, skipping AI service startup."
    return
  }

  Write-Host "Starting AI service on 9000..."
  $cmd = @(
    "cd /d `"$aiService`"",
    "python -m pip install -q -r requirements.txt",
    "python -m uvicorn main:app --host 0.0.0.0 --port 9000 1> `"$logs\ai.out.log`" 2> `"$logs\ai.err.log`""
  )
  $joined = [string]::Join(" && ", $cmd)
  Start-Process cmd.exe -ArgumentList "/c", $joined -WindowStyle Hidden
}

function Restart-Backend($deployment) {
  $listenerPid = Get-ListenerPid 8080
  if ($listenerPid) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  }

  $cmd = @(
    "cd /d `"$backend`"",
    "set PINATA_JWT=$([Environment]::GetEnvironmentVariable('PINATA_JWT','User'))",
    "set AI_ENABLED=true",
    "set AI_EMBEDDING_ENDPOINT=http://127.0.0.1:9000/embedding",
    "set AI_MODERATION_ENDPOINT=http://127.0.0.1:9000/moderation",
    "set AI_SUMMARY_ENDPOINT=http://127.0.0.1:9000/summary",
    "set DAO_ENABLED=true",
    "set DAO_RPC_URL=http://127.0.0.1:8545",
    "set DAO_TOKEN_ADDRESS=$($deployment.token)",
    "set DAO_GOVERNANCE_ADDRESS=$($deployment.dao)",
    "set DAO_TREASURY_ADDRESS=$($deployment.treasury)"
  )

  $cmd += "mvn spring-boot:run 1> `"$logs\backend.out.log`" 2> `"$logs\backend.err.log`""
  $joined = [string]::Join(" && ", $cmd)

  Write-Host "Starting backend on 8080..."
  Start-Process cmd.exe -ArgumentList "/c", $joined -WindowStyle Hidden
}

Start-HardhatNode
$deployment = Deploy-Dao
Write-FrontendEnv $deployment
Restart-AiService
Restart-Frontend
Restart-Backend $deployment

$p8545 = Wait-ForPort 8545 10
$p5173 = Wait-ForPort 5173 30
$p9000 = Wait-ForPort 9000 45
$p8080 = Wait-ForPort 8080 60

Write-Host ""
Write-Host "Local DAO stack status:"
Write-Host "  hardhat(8545): $p8545"
Write-Host "  backend(8080): $p8080"
Write-Host "  frontend(5173): $p5173"
Write-Host "  ai-service(9000): $p9000"
Write-Host "  DAO: $($deployment.dao)"
Write-Host "  Token: $($deployment.token)"
Write-Host "  Treasury: $($deployment.treasury)"
