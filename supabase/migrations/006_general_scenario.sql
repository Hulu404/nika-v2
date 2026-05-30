-- 006_general_scenario.sql
-- Сценарий «general» (Просто поговорить) — добавлен в коде, но enum в БД
-- отставал, из-за чего createConversation падал при клике «Просто поговорить».

alter type scenario_type add value if not exists 'general';
