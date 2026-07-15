INSERT INTO public.categories (name, slug, emoji, sort_order) VALUES
('Anxiety','anxiety','😌',1),
('Relationships','relationships','💕',2),
('Work Stress','work-stress','💼',3),
('Loneliness','loneliness','🫂',4),
('Family','family','👨‍👩‍👧',5),
('Breakups','breakups','💔',6),
('Motivation','motivation','🔥',7),
('Grief','grief','🕊️',8),
('Confidence','confidence','✨',9),
('Sleep','sleep','🌙',10),
('LGBTQ+','lgbtq','🏳️‍🌈',11),
('Vent','vent','🗣️',12)
ON CONFLICT (slug) DO NOTHING;