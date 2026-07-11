-- MARIA SMM OS
-- Распространённые в России площадки: мессенджеры, комьюнити, ниши
-- Version 1.3 | 2026-07-11

alter type public.channel_platform add value if not exists 'whatsapp';
alter type public.channel_platform add value if not exists 'viber';
alter type public.channel_platform add value if not exists 'tenchat';
alter type public.channel_platform add value if not exists 'yappy';
alter type public.channel_platform add value if not exists 'pikabu';
alter type public.channel_platform add value if not exists 'habr';
alter type public.channel_platform add value if not exists 'boosty';
alter type public.channel_platform add value if not exists 'pinterest';
alter type public.channel_platform add value if not exists 'twitter';
alter type public.channel_platform add value if not exists 'linkedin';
