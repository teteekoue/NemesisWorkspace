/**
 * NemesisWorkspace — les sauvegardes, vues depuis l'accueil.
 *
 * La mécanique vit dans `src/shared/backups.js`, parce que le SDK local s'en
 * sert à chaque enregistrement : c'est ainsi qu'une version est déposée même
 * quand l'utilisateur n'a jamais ouvert l'accueil. Ce fichier ne fait que
 * réexporter, pour que les vues de l'accueil aient un point d'entrée clair.
 */

export {
  BACKUP_ROOT,
  listBackups,
  maybeBackup,
  backupNow,
  restoreBackup,
  dropBackups,
  exportVersion,
  backupsUsage,
  clearBackups,
} from '../../../shared/backups.js';
