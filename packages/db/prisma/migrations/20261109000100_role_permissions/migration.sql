-- CreateTable
CREATE TABLE "RolePermission" (
    "role" "Role" NOT NULL,
    "permission" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role","permission")
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'wcc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "RolePermission" TO wcc_app;
  END IF;
END $$;
