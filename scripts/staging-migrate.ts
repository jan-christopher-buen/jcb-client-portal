import { runStagingMigration } from './staging-migration-launcher.js'
process.exitCode = await runStagingMigration(process.env)
