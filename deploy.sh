#!/bin/bash
set +ex

if [[ "$(whoami)" != "root" ]]; then
    printf  "!!!!!!!!!!!!!!!!!!!!!\nNeed sudo rights to run this file\n!!!!!!!!!!!!!!!!!!!!!\n"
    exit 1
fi

APP_USER=nodejs
APP_DIR=/data/nodejs/brower
VERSION=1.0.0
TID=AS
PID=PID0256

if [ ! -d "$APP_DIR" ]; then
    mkdir -p "$APP_DIR"
fi

# make sure app folder is supervised by APP_USER
chown nodejs:$APP_USER  $APP_DIR

# reinitialize SysV daemon
rm -rf /etc/init.d/pm2-init.sh
cp ./pm2-init.sh  /etc/init.d/
chmod +x /etc/init.d/pm2-init.sh
chkconfig --del pm2-init.sh
chkconfig --add pm2-init.sh

# run command with APP USER to get rid of chown
suapp() {
    su - $APP_USER -c "$*"
}

# when app run with nodejs, nodejs should redirect all git protocol
suapp "git config --global url."https://".insteadOf git://"

# move file to deploy folder
rm -rf $APP_DIR/deploy/${VERSION}
suapp "mkdir -p $APP_DIR/deploy/${VERSION}; cd $_; curl  -u pwang2 https://jenkins.morningstar.com/job/PS/job/SFS/job/brower/ws/archive.tar.gz -o archive.tar.gz; "

# delete app directory and untar files
rm -rf $APP_DIR/app
suapp "mkdir -p $APP_DIR/app; tar xzf $APP_DIR/deploy/${VERSION}/archive.tar.gz -C $_"

# This assume current app is the only app managed by PM2
suapp pm2 stop all
suapp pm2 delete all

# start web server
suapp "cd $APP_DIR/app; CDN_PHYSICAL_PATH=$APP_DIR/cdn pm2 start $APP_DIR/app/processes.json"

# save the current process as dump which will be reloaded with System reboot
suapp pm2 save

