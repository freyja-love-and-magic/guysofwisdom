#!/bin/bash
# Mounted over the image's start.sh by scripts/base-up.sh.
# Runs only what guysofwisdom needs, and takes the Stripe keys from the container's environment
# (the image's own start.sh hardcodes "<api key here>").
cat > ecosystem.config.js << 'EOL'
module.exports = {
  apps: [
    { name: 'continuebee', script: '/usr/src/app/continuebee/src/server/node/continuebee.js', env: { LOCALHOST: 'true' } },
    { name: 'fount', script: '/usr/src/app/fount/src/server/node/fount.js', env: { LOCALHOST: 'true' } },
    { name: 'bdo', script: '/usr/src/app/bdo/src/server/node/bdo.js', env: { LOCALHOST: 'true' } },
    {
      name: 'addie',
      script: '/usr/src/app/addie/src/server/node/addie.js',
      env: {
        LOCALHOST: 'true',
        STRIPE_KEY: process.env.STRIPE_KEY,
        STRIPE_PUBLISHING_KEY: process.env.STRIPE_PUBLISHING_KEY
      }
    }
  ]
}
EOL

pm2-runtime start ecosystem.config.js
