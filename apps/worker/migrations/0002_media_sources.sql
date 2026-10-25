-- Этап 2: в KV лежит только обложка, галерея и видео проксируются из Telegram по запросу.
-- source — файл для галереи, cover_source — размер для обложки (~800 px), blur_source — самый маленький
-- размер для размытого превью, poster_source — кадр-превью видео. blur — готовое превью как data: URI.
ALTER TABLE media ADD COLUMN cover_source TEXT;
ALTER TABLE media ADD COLUMN blur_source TEXT;
ALTER TABLE media ADD COLUMN poster_source TEXT;
ALTER TABLE media ADD COLUMN blur TEXT;
