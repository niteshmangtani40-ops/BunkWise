/**
 * settings.js — App Settings & Data Management
 */
import { getProfile, saveProfile, getAllSettings, saveSetting, exportData, clearAllData, importData, createBackup, getAllBackups, restoreBackup, deleteBackup } from '../db.js';
import { showToast, showConfirm } from '../notifications.js';

export async function init() {
  await loadData();
  setupEvents();
  await loadBackupHistory();
}
export async function refresh() {
    await loadData();
    await loadBackupHistory();
}
async function loadData() {
  const [prof, set] = await Promise.all([getProfile(), getAllSettings()]);
  
  document.getElementById('set-name').value = prof?.name || '';
  document.getElementById('set-college').value = prof?.college || '';
  document.getElementById('set-semester').value = prof?.semester || '';
  document.getElementById('set-target').value = prof?.attendanceTarget || set?.attendanceTarget || 75;
  
  document.getElementById('set-theme').value = set?.theme || 'dark';
}

function setupEvents() {
  document.getElementById('btn-save-profile').addEventListener('click', async () => {
    const prof = {
      name: document.getElementById('set-name').value.trim(),
      college: document.getElementById('set-college').value.trim(),
      semester: document.getElementById('set-semester').value.trim(),
      attendanceTarget: Number(document.getElementById('set-target').value) || 75
    };
    await saveProfile(prof);
    await saveSetting('attendanceTarget', prof.attendanceTarget);
    showToast('Profile saved successfully', 'success');
  });

  document.getElementById('btn-create-backup').addEventListener('click', async () => {
    try {
      const name = `Backup ${new Date().toLocaleString()}`;
      await createBackup(name);
      showToast('Backup snapshot saved', 'success');
      await loadBackupHistory();
    } catch (error) {
      console.error('[Settings] Backup failed:', error);
      showToast('Could not create backup snapshot', 'error');
    }
  });
  
  document.getElementById('set-theme').addEventListener('change', async (e) => {
    const theme = e.target.value;
    await saveSetting('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  });
  
  document.getElementById('btn-export').addEventListener('click', async () => {
    try {
      const data = await exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bunkwise_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported successfully', 'success');
    } catch(err) {
      showToast('Export failed', 'error');
    }
  });
  
  document.getElementById('btn-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const ok = await showConfirm('Import Data', 'This will overwrite your existing data. Are you sure?', 'Import', 'warning');
    if (!ok) {
      e.target.value = '';
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        await importData(ev.target.result);
        showToast('Data imported successfully. Reloading...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        showToast('Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  
  document.getElementById('btn-reset').addEventListener('click', async () => {
    const ok = await showConfirm('Reset All Data', 'This will permanently delete ALL subjects, attendance, and timetable data. This action cannot be undone.', 'Delete Everything', 'danger');
    if (ok) {
      await clearAllData();
      showToast('All data cleared.', 'success');
      setTimeout(() => { window.location.href = './index.html'; }, 1000);
    }
  });
}

async function loadBackupHistory() {
  const container = document.getElementById('backup-history');
  if (!container) return;

  try {
    const backups = (await getAllBackups()).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!backups.length) {
      container.innerHTML = '<div style="color:var(--text-secondary);font-size:14px">No backups created yet.</div>';
      return;
    }

    container.innerHTML = backups.slice(0, 5).map((backup) => `
      <div class="card" style="padding:var(--space-3);margin-bottom:var(--space-3)">
        <div style="display:flex;justify-content:space-between;gap:var(--space-3);align-items:flex-start">
          <div>
            <div style="font-weight:700">${escapeHtml(backup.name || 'Backup')}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${new Date(backup.createdAt || Date.now()).toLocaleString()}</div>
          </div>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" data-restore-backup="${backup.id}">Restore</button>
            <button class="btn btn-ghost btn-sm" data-delete-backup="${backup.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-restore-backup]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const id = Number(event.currentTarget.dataset.restoreBackup);
        const ok = await showConfirm('Restore Backup', 'This will overwrite current app data. Continue?', 'Restore', 'primary');
        if (!ok) return;
        try {
          await restoreBackup(id);
          showToast('Backup restored successfully', 'success');
          window.location.reload();
        } catch (error) {
          console.error('[Settings] Restore failed:', error);
          showToast('Could not restore backup', 'error');
        }
      });
    });

    container.querySelectorAll('[data-delete-backup]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const id = Number(event.currentTarget.dataset.deleteBackup);
        const ok = await showConfirm('Delete Backup', 'This backup will be removed permanently.', 'Delete', 'danger');
        if (!ok) return;
        await deleteBackup(id);
        showToast('Backup deleted', 'success');
        await loadBackupHistory();
      });
    });
  } catch (error) {
    console.error('[Settings] Could not load backups:', error);
    container.innerHTML = '<div style="color:var(--color-danger)">Unable to load backup history.</div>';
  }
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}
