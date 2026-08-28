CREATE TABLE "alert_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "threshold" DECIMAL(15,2) NOT NULL,
    "is_below" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "alert_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alert_states_user_id_kind_key" ON "alert_states"("user_id", "kind");
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
