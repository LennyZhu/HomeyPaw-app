alter type public.care_type add value if not exists 'health';
alter type public.care_task_schedule_type add value if not exists 'yearly';

create type public.health_observation_type as enum (
  'stool',
  'vomiting',
  'energy'
);

create type public.care_task_category as enum (
  'standard',
  'birthday'
);
