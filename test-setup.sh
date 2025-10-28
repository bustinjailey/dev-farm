#!/bin/bash
# Quick test to verify Dev Farm setup

echo "🚜 Dev Farm - Setup Test"
echo "========================"
echo ""

# Check Docker
echo -n "Checking Docker... "
if docker info > /dev/null 2>&1; then
    echo "✓ OK"
else
    echo "✗ FAILED - Docker not running"
    exit 1
fi

# Check Docker Compose
echo -n "Checking Docker Compose... "
if docker-compose version > /dev/null 2>&1 || docker compose version > /dev/null 2>&1; then
    echo "✓ OK"
else
    echo "✗ FAILED - Docker Compose not found"
    exit 1
fi

# Check directory structure
echo -n "Checking directory structure... "
if [ -d "dashboard" ] && [ -d "docker" ] && [ -d "scripts" ]; then
    echo "✓ OK"
else
    echo "✗ FAILED - Missing directories"
    exit 1
fi

# Check required files
echo -n "Checking required files... "
if [ -f "docker-compose.yml" ] && [ -f "scripts/devfarm.sh" ] && [ -f "dashboard/app.py" ]; then
    echo "✓ OK"
else
    echo "✗ FAILED - Missing files"
    exit 1
fi

# Check script permissions
echo -n "Checking script permissions... "
if [ -x "scripts/devfarm.sh" ]; then
    echo "✓ OK"
else
    echo "✗ FAILED - devfarm.sh not executable"
    exit 1
fi

echo ""
echo "✓ All checks passed!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and add your GitHub token (optional)"
echo "2. Run: ./scripts/devfarm.sh setup"
echo "3. Access dashboard at: http://localhost:5000"
