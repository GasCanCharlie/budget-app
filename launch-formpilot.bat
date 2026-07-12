@echo off
cd /d "C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\formpilot"
start "FormPilot API" cmd /k "cd /d C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\formpilot\api && uvicorn main:app --reload --port 8000"
start "FormPilot Web" cmd /k "cd /d C:\Users\dachn\Dropbox\My PC (DESKTOP-ACSQURB)\Desktop\HAMMAN LLC\formpilot\web && npm run dev"
claude
