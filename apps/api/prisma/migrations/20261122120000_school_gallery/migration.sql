CREATE TABLE "SchoolGalleryPhoto" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "lowUrl" TEXT,
  "alt" TEXT NOT NOT NULL,
  "label" TEXT NOT NULL,
  "position" TEXT NOT NULL DEFAULT '50% 50%',
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolGalleryPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SchoolGalleryPhoto_active_order_idx"
ON "SchoolGalleryPhoto"("active", "order");
