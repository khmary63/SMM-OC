-- MARIA SMM OS
-- Платформы VC.ru, Threads и TikTok (Дзен и Одноклассники уже есть в enum)
-- Version 1.2 | 2026-07-11

alter type public.channel_platform add value if not exists 'vcru';
alter type public.channel_platform add value if not exists 'threads';
alter type public.channel_platform add value if not exists 'tiktok';
