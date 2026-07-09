-- 009_gender_neutral.sql
-- Новый чат-онбординг собирает род 'neutral' («без разницы»). Расширяем enum
-- gender этим значением; существующие 'male'/'female' не трогаем.
-- ALTER TYPE ... ADD VALUE выполняется отдельным оператором (не в транзакции
-- с использованием значения) — здесь это единственный оператор файла.

alter type gender add value if not exists 'neutral';
