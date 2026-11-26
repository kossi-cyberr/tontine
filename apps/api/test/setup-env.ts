import { resolve } from 'node:path';
import { config } from 'dotenv';

// Les tests tournent depuis apps/api : le .env est à la racine du monorepo.
config({ path: resolve(__dirname, '../../../.env') });

// Ce fichier s'exécute avant l'import des modules : la valeur est donc lue par
// ConfigModule.forRoot(), qui fige la configuration au moment de l'import.
process.env.OTP_FIXED_CODE = '000000';
process.env.NODE_ENV = 'test';
// Les tests déclenchent eux-mêmes les webhooks, de façon déterministe.
process.env.MOCK_PROVIDER_AUTO_CONFIRM = 'false';
