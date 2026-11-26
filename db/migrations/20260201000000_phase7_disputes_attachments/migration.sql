-- Pièces jointes d'un litige : liste d'URLs (stockage externe), vide par défaut.
ALTER TABLE "disputes" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
