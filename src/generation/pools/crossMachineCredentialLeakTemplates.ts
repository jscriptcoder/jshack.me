// Cross-machine credential leak templates — found after privilege escalation.
// {{target_ip}}, {{target_username}}, {{target_password}} are filled with a same-layer machine's creds.
// {{owner}} is replaced with the file owner's username (for home directory paths).
// owner controls file permissions: 'root' = only root can read, 'user' = root + user.
export type CrossMachineCredentialLeakTemplate = {
  readonly path: string;
  readonly content: string;
  readonly owner: 'root' | 'user';
  readonly binary?: boolean;
};

export const crossMachineCredentialLeakTemplates: readonly CrossMachineCredentialLeakTemplate[] = [
  // Deploy/automation scripts (root-owned)
  {
    path: '/root/.ssh/config',
    owner: 'root',
    content: [
      'Host internal-server',
      '    HostName {{target_ip}}',
      '    User {{target_username}}',
      '    # Password: {{target_password}}',
      '    StrictHostKeyChecking no',
      '    UserKnownHostsFile /dev/null',
    ].join('\n'),
  },
  {
    path: '/opt/deploy/hosts.ini',
    owner: 'root',
    content: [
      '[webservers]',
      '{{target_ip}} ansible_user={{target_username}} ansible_password={{target_password}}',
      '',
      '[webservers:vars]',
      'ansible_connection=ssh',
      'ansible_become=yes',
    ].join('\n'),
  },
  {
    path: '/opt/ansible/inventory.yml',
    owner: 'root',
    content: [
      'all:',
      '  hosts:',
      '    app-server:',
      '      ansible_host: {{target_ip}}',
      '      ansible_user: {{target_username}}',
      '      ansible_ssh_pass: {{target_password}}',
      '      ansible_become: true',
    ].join('\n'),
  },
  {
    path: '/root/deploy.sh',
    owner: 'root',
    content: [
      '#!/bin/bash',
      '# Deploy script — push latest build to app server',
      'TARGET={{target_ip}}',
      'USER={{target_username}}',
      'PASS={{target_password}}',
      '',
      'sshpass -p "$PASS" scp -o StrictHostKeyChecking=no ./build.tar.gz $USER@$TARGET:/opt/app/',
      'sshpass -p "$PASS" ssh $USER@$TARGET "cd /opt/app && tar xzf build.tar.gz && ./restart.sh"',
    ].join('\n'),
  },
  // Backup scripts (root-owned)
  {
    path: '/etc/cron.d/remote-backup',
    owner: 'root',
    content: [
      'SHELL=/bin/bash',
      '# Nightly backup sync to {{target_ip}}',
      '0 3 * * * root sshpass -p "{{target_password}}" rsync -az /var/backups/ {{target_username}}@{{target_ip}}:/backups/',
    ].join('\n'),
  },
  {
    path: '/opt/backups/sync.sh',
    owner: 'root',
    content: [
      '#!/bin/bash',
      '# Sync local backups to remote storage',
      'REMOTE_HOST={{target_ip}}',
      'REMOTE_USER={{target_username}}',
      'REMOTE_PASS={{target_password}}',
      '',
      'sshpass -p "$REMOTE_PASS" rsync -avz --delete \\',
      '  /var/backups/ $REMOTE_USER@$REMOTE_HOST:/mnt/backups/',
      'echo "[$(date)] Sync complete" >> /var/log/backup-sync.log',
    ].join('\n'),
  },
  {
    path: '/root/.netrc',
    owner: 'root',
    content: [
      'machine {{target_ip}}',
      '  login {{target_username}}',
      '  password {{target_password}}',
    ].join('\n'),
  },
  // App configs referencing remote services (user-owned)
  {
    path: '/home/{{owner}}/projects/.env',
    owner: 'user',
    content: [
      'APP_ENV=development',
      'APP_DEBUG=true',
      '',
      'DB_HOST={{target_ip}}',
      'DB_PORT=3306',
      'DB_USER={{target_username}}',
      'DB_PASS={{target_password}}',
      '',
      'REDIS_HOST={{target_ip}}',
      'REDIS_PORT=6379',
    ].join('\n'),
  },
  {
    path: '/home/{{owner}}/.bash_history',
    owner: 'user',
    content: [
      'ls -la',
      'cd /opt/app',
      'vim config.yml',
      'ssh {{target_username}}@{{target_ip}}',
      'sshpass -p "{{target_password}}" ssh {{target_username}}@{{target_ip}}',
      'cat /var/log/app.log | tail -50',
      'systemctl restart app',
      'exit',
    ].join('\n'),
  },
  // Service configs (root-owned)
  {
    path: '/etc/supervisor/conf.d/tunnel.conf',
    owner: 'root',
    content: [
      '[program:ssh-tunnel]',
      'command=sshpass -p "{{target_password}}" ssh -N -L 3306:localhost:3306 {{target_username}}@{{target_ip}}',
      'autostart=true',
      'autorestart=true',
      'stderr_logfile=/var/log/tunnel.err.log',
      'stdout_logfile=/var/log/tunnel.out.log',
    ].join('\n'),
  },
  {
    path: '/opt/docker/docker-compose.yml',
    owner: 'root',
    content: [
      'version: "3.8"',
      'services:',
      '  app:',
      '    image: app:latest',
      '    environment:',
      '      - DB_HOST={{target_ip}}',
      '      - DB_USER={{target_username}}',
      '      - DB_PASS={{target_password}}',
      '    restart: unless-stopped',
    ].join('\n'),
  },
  // Infrastructure files (root-owned)
  {
    path: '/etc/fstab.bak',
    owner: 'root',
    content: [
      '# /etc/fstab — static filesystem table (backup before NFS migration)',
      'UUID=a1b2c3d4 /              ext4    errors=remount-ro 0 1',
      'UUID=e5f6a7b8 /boot          ext4    defaults          0 2',
      '# NFS mount — credentials in-line for testing',
      '//{{target_ip}}/share /mnt/share cifs username={{target_username}},password={{target_password}},iocharset=utf8 0 0',
    ].join('\n'),
  },
  {
    path: '/opt/scripts/db_check.sh',
    owner: 'root',
    content: [
      '#!/bin/bash',
      '# Check remote database health',
      'DB_HOST={{target_ip}}',
      'DB_USER={{target_username}}',
      'DB_PASS={{target_password}}',
      '',
      'mysql -h $DB_HOST -u $DB_USER -p$DB_PASS -e "SELECT 1" > /dev/null 2>&1',
      'if [ $? -ne 0 ]; then',
      '  echo "CRITICAL: Database at $DB_HOST unreachable" | mail -s "DB Alert" ops@corp.local',
      'fi',
    ].join('\n'),
  },
  // Binary with embedded remote creds
  {
    path: '/usr/local/bin/remote_monitor',
    owner: 'root',
    binary: true,
    content: [
      'remote_monitor v1.4.2 — compiled service checker',
      'target_host={{target_ip}}',
      'auth_user={{target_username}}',
      'auth_pass={{target_password}}',
      'check_interval=120',
      'alert_threshold=3',
    ].join('\n'),
  },
];
