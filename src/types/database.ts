export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      chat_messages: {
        Row: {
          body: string;
          client_message_id: string;
          created_at: string;
          id: string;
          pet_id: string;
          sender_id: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'chat_messages_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_read_states: {
        Row: {
          last_read_at: string;
          last_read_message_id: string;
          pet_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'chat_read_states_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      care_logs: {
        Row: {
          care_type: Database['public']['Enums']['care_type'];
          created_at: string;
          duration_minutes: number | null;
          id: string;
          local_date: string;
          note: string | null;
          occurred_at: string;
          performed_by: string;
          pet_id: string;
          time_zone: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'care_logs_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      care_shifts: {
        Row: {
          assignee_user_id: string | null;
          canceled_at: string | null;
          canceled_by: string | null;
          claimed_at: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          local_date: string;
          note: string | null;
          pet_id: string;
          split_from_shift_id: string | null;
          status: Database['public']['Enums']['care_schedule_status'];
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'care_shifts_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'care_shifts_split_from_shift_id_fkey';
            columns: ['split_from_shift_id'];
            isOneToOne: false;
            referencedRelation: 'care_shifts';
            referencedColumns: ['id'];
          },
        ];
      };
      care_shift_tasks: {
        Row: {
          canceled_at: string | null;
          canceled_by: string | null;
          care_task_id: string;
          created_at: string;
          id: string;
          pet_id: string;
          shift_id: string;
          source_scheduled_for: string;
          status: Database['public']['Enums']['care_schedule_status'];
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'care_shift_tasks_shift_pet_fkey';
            columns: ['shift_id', 'pet_id'];
            isOneToOne: false;
            referencedRelation: 'care_shifts';
            referencedColumns: ['id', 'pet_id'];
          },
          {
            foreignKeyName: 'care_shift_tasks_task_pet_fkey';
            columns: ['care_task_id', 'pet_id'];
            isOneToOne: false;
            referencedRelation: 'care_tasks';
            referencedColumns: ['id', 'pet_id'];
          },
        ];
      };
      care_task_completions: {
        Row: {
          care_log_id: string;
          care_shift_task_id: string | null;
          completed_at: string;
          completed_by: string;
          created_at: string;
          id: string;
          pet_id: string;
          scheduled_for: string;
          task_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'care_task_completions_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'care_tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'care_task_completions_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'care_task_completions_care_log_id_fkey';
            columns: ['care_log_id'];
            isOneToOne: true;
            referencedRelation: 'care_logs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'care_task_completions_shift_task_fkey';
            columns: ['care_shift_task_id'];
            isOneToOne: true;
            referencedRelation: 'care_shift_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      care_tasks: {
        Row: {
          care_type: Database['public']['Enums']['care_type'] | null;
          created_at: string;
          created_by: string | null;
          deactivated_at: string | null;
          id: string;
          is_active: boolean;
          local_time: string | null;
          month_day: number | null;
          note: string | null;
          pet_id: string;
          schedule_type: Database['public']['Enums']['care_task_schedule_type'];
          scheduled_at: string | null;
          starts_on: string | null;
          time_zone: string;
          title: string;
          updated_at: string;
          week_day: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'care_tasks_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      pet_invites: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          invited_by: string;
          max_uses: number;
          pet_id: string;
          revoked_at: string | null;
          used_count: number;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'pet_invites_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          locale: 'zh-HK' | 'en';
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          locale?: 'zh-HK' | 'en';
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          display_name?: string;
          locale?: 'zh-HK' | 'en';
        };
        Relationships: [];
      };
      pet_members: {
        Row: {
          created_at: string;
          pet_id: string;
          role: Database['public']['Enums']['pet_member_role'];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          pet_id: string;
          role: Database['public']['Enums']['pet_member_role'];
          user_id: string;
        };
        Update: {
          role?: Database['public']['Enums']['pet_member_role'];
        };
        Relationships: [
          {
            foreignKeyName: 'pet_members_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      post_media: {
        Row: {
          created_at: string;
          height: number;
          id: string;
          mime_type: string;
          position: number;
          post_id: string;
          storage_path: string;
          width: number;
        };
        Insert: {
          created_at?: string;
          height: number;
          id: string;
          mime_type?: string;
          position: number;
          post_id: string;
          storage_path: string;
          width: number;
        };
        Update: {
          height?: number;
          mime_type?: string;
          position?: number;
          storage_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'post_media_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
        ];
      };
      posts: {
        Row: {
          author_id: string;
          content: string | null;
          created_at: string;
          event_date: string;
          id: string;
          location_name: string | null;
          pet_id: string;
          tag: Database['public']['Enums']['post_tag'] | null;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          content?: string | null;
          created_at?: string;
          event_date?: string;
          id: string;
          location_name?: string | null;
          pet_id: string;
          tag?: Database['public']['Enums']['post_tag'] | null;
          updated_at?: string;
        };
        Update: {
          content?: string | null;
          event_date?: string;
          location_name?: string | null;
          tag?: Database['public']['Enums']['post_tag'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'posts_pet_id_fkey';
            columns: ['pet_id'];
            isOneToOne: false;
            referencedRelation: 'pets';
            referencedColumns: ['id'];
          },
        ];
      };
      pets: {
        Row: {
          adoption_date: string | null;
          avatar_path: string | null;
          birthday: string | null;
          breed: string | null;
          created_at: string;
          description: string | null;
          gender: Database['public']['Enums']['pet_gender'];
          id: string;
          name: string;
          species: Database['public']['Enums']['pet_species'];
          updated_at: string;
          weight: number | null;
        };
        Insert: {
          adoption_date?: string | null;
          avatar_path?: string | null;
          birthday?: string | null;
          breed?: string | null;
          created_at?: string;
          description?: string | null;
          gender?: Database['public']['Enums']['pet_gender'];
          id?: string;
          name: string;
          species: Database['public']['Enums']['pet_species'];
          updated_at?: string;
          weight?: number | null;
        };
        Update: {
          adoption_date?: string | null;
          avatar_path?: string | null;
          birthday?: string | null;
          breed?: string | null;
          description?: string | null;
          gender?: Database['public']['Enums']['pet_gender'];
          name?: string;
          species?: Database['public']['Enums']['pet_species'];
          weight?: number | null;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      add_care_shift_tasks: {
        Args: { target_shift_id: string; task_items: Json };
        Returns: Database['public']['Tables']['care_shift_tasks']['Row'][];
      };
      cancel_care_shift: {
        Args: { target_shift_id: string };
        Returns: 'canceled' | 'canceled_remaining';
      };
      cancel_care_shift_task: {
        Args: { target_shift_task_id: string };
        Returns: 'canceled';
      };
      claim_care_shift: {
        Args: { target_shift_id: string };
        Returns: Database['public']['Tables']['care_shifts']['Row'];
      };
      complete_care_shift_task: {
        Args: {
          care_log_id: string;
          completion_duration_minutes?: number | null;
          completion_id: string;
          completion_note?: string | null;
          target_shift_task_id: string;
        };
        Returns: {
          completion_status: 'completed' | 'already_completed';
          result_care_log_id: string;
          result_completed_at: string;
          result_completed_by: string;
          result_completion_id: string;
        }[];
      };
      create_care_shift: {
        Args: {
          shift_id: string;
          shift_local_date: string;
          shift_note: string | null;
          target_assignee_user_id: string | null;
          target_pet_id: string;
          task_items: Json;
        };
        Returns: Database['public']['Tables']['care_shifts']['Row'];
      };
      delete_chat_message: {
        Args: { target_message_id: string };
        Returns: boolean;
      };
      get_chat_messages_page: {
        Args: {
          before_created_at?: string | null;
          before_message_id?: string | null;
          requested_limit?: number;
          target_pet_id: string;
        };
        Returns: Database['public']['Tables']['chat_messages']['Row'][];
      };
      get_chat_unread_count: {
        Args: { target_pet_id: string };
        Returns: number;
      };
      get_pet_chat_channel_version: {
        Args: { target_pet_id: string };
        Returns: number;
      };
      get_pet_chat_members: {
        Args: { target_pet_id: string };
        Returns: {
          member_avatar_url: string | null;
          member_display_name: string;
          member_joined_at: string;
          member_role: Database['public']['Enums']['pet_member_role'];
          member_user_id: string;
        }[];
      };
      mark_chat_read: {
        Args: { target_message_id: string; target_pet_id: string };
        Returns: Database['public']['Tables']['chat_read_states']['Row'];
      };
      send_chat_message: {
        Args: {
          message_body: string;
          target_client_message_id: string;
          target_pet_id: string;
        };
        Returns: Database['public']['Tables']['chat_messages']['Row'];
      };
      update_chat_message: {
        Args: { message_body: string; target_message_id: string };
        Returns: Database['public']['Tables']['chat_messages']['Row'];
      };
      complete_care_task: {
        Args: {
          care_log_id: string;
          completion_duration_minutes?: number | null;
          completion_id: string;
          completion_note?: string | null;
          occurrence_scheduled_for: string;
          target_task_id: string;
        };
        Returns: {
          completion_status: 'completed' | 'already_completed';
          result_care_log_id: string;
          result_completed_at: string;
          result_completed_by: string;
          result_completion_id: string;
        }[];
      };
      create_care_task: {
        Args: {
          target_pet_id: string;
          task_care_type: Database['public']['Enums']['care_type'] | null;
          task_id: string;
          task_local_time: string | null;
          task_month_day: number | null;
          task_note: string | null;
          task_schedule_type: Database['public']['Enums']['care_task_schedule_type'];
          task_scheduled_at: string | null;
          task_starts_on: string | null;
          task_time_zone: string;
          task_title: string;
          task_week_day: number | null;
        };
        Returns: Database['public']['Tables']['care_tasks']['Row'];
      };
      create_pet: {
        Args: {
          pet_adoption_date?: string | null;
          pet_birthday?: string | null;
          pet_breed?: string | null;
          pet_description?: string | null;
          pet_gender?: Database['public']['Enums']['pet_gender'];
          pet_name: string;
          pet_species: Database['public']['Enums']['pet_species'];
          pet_weight?: number | null;
        };
        Returns: Database['public']['Tables']['pets']['Row'];
      };
      create_care_log: {
        Args: {
          care_duration_minutes?: number | null;
          care_id: string;
          care_kind: Database['public']['Enums']['care_type'];
          care_note?: string | null;
          care_occurred_at: string;
          care_time_zone: string;
          target_pet_id: string;
        };
        Returns: Database['public']['Tables']['care_logs']['Row'];
      };
      deactivate_care_task: {
        Args: { target_task_id: string };
        Returns: 'deactivated' | 'already_inactive';
      };
      get_care_task_occurrences: {
        Args: {
          target_pet_id?: string | null;
          window_end: string;
          window_start: string;
        };
        Returns: {
          can_edit: boolean;
          can_undo: boolean;
          care_log_id: string | null;
          care_type: Database['public']['Enums']['care_type'] | null;
          completed_at: string | null;
          completed_by: string | null;
          completer_display_name: string | null;
          completion_id: string | null;
          created_by: string | null;
          creator_display_name: string | null;
          is_active: boolean;
          local_time: string | null;
          month_day: number | null;
          note: string | null;
          pet_id: string;
          pet_name: string;
          schedule_type: Database['public']['Enums']['care_task_schedule_type'];
          scheduled_at: string | null;
          scheduled_for: string;
          starts_on: string | null;
          task_id: string;
          time_zone: string;
          title: string;
          week_day: number | null;
        }[];
      };
      get_care_schedule_range: {
        Args: {
          range_end: string;
          range_start: string;
          target_pet_id: string;
        };
        Returns: {
          assignee_display_name: string | null;
          assignee_avatar_path: string | null;
          assignee_user_id: string | null;
          care_log_id: string | null;
          care_task_id: string;
          claimed_at: string | null;
          completed_at: string | null;
          completed_by: string | null;
          completer_display_name: string | null;
          completion_id: string | null;
          local_date: string;
          pet_id: string;
          shift_canceled_at: string | null;
          shift_id: string;
          shift_note: string | null;
          shift_status: Database['public']['Enums']['care_schedule_status'];
          shift_task_canceled_at: string | null;
          shift_task_id: string;
          shift_task_status: Database['public']['Enums']['care_schedule_status'];
          source_scheduled_for: string;
          split_from_shift_id: string | null;
          task_care_type: Database['public']['Enums']['care_type'] | null;
          task_note: string | null;
          task_time_zone: string;
          task_title: string;
        }[];
      };
      create_pet_invite: {
        Args: { target_pet_id: string };
        Returns: {
          invite_code: string;
          invite_created_at: string;
          invite_expires_at: string;
          invite_id: string;
          invite_max_uses: number;
          invite_used_count: number;
        }[];
      };
      create_post: {
        Args: {
          media_items?: Json;
          post_content: string | null;
          post_event_date: string;
          post_id: string;
          post_location_name: string | null;
          post_pet_id: string;
          post_tag: Database['public']['Enums']['post_tag'] | null;
        };
        Returns: Database['public']['Tables']['posts']['Row'];
      };
      get_pet_members: {
        Args: { target_pet_id: string };
        Returns: {
          member_avatar_path: string | null;
          member_display_name: string;
          member_joined_at: string;
          member_role: Database['public']['Enums']['pet_member_role'];
          member_user_id: string;
        }[];
      };
      get_pet_care_performers: {
        Args: { target_pet_id: string };
        Returns: {
          performer_display_name: string;
          performer_user_id: string;
        }[];
      };
      get_pet_memory: {
        Args: { local_today: string; target_pet_id: string };
        Returns: {
          memory_kind: 'on_this_day' | 'recent';
          memory_post_id: string;
          memory_years_ago: number | null;
        }[];
      };
      get_pet_post_authors: {
        Args: { target_pet_id: string };
        Returns: {
          author_display_name: string;
          author_user_id: string;
        }[];
      };
      join_pet_with_invite: {
        Args: { invite_code: string };
        Returns: {
          join_status: 'already_member' | 'joined';
          joined_pet_id: string;
          joined_pet_name: string;
        }[];
      };
      preview_pet_invite: {
        Args: { invite_code: string };
        Returns: {
          inviter_display_name: string;
          pet_breed: string | null;
          pet_name: string;
          pet_species: Database['public']['Enums']['pet_species'];
        }[];
      };
      remove_pet_member: {
        Args: { target_pet_id: string; target_user_id: string };
        Returns: 'not_found' | 'removed';
      };
      revoke_pet_invite: {
        Args: { target_pet_id: string };
        Returns: boolean;
      };
      update_post: {
        Args: {
          media_items?: Json;
          post_content: string | null;
          post_event_date: string;
          post_location_name: string | null;
          post_tag: Database['public']['Enums']['post_tag'] | null;
          target_post_id: string;
        };
        Returns: Database['public']['Tables']['posts']['Row'];
      };
      update_care_log: {
        Args: {
          care_duration_minutes?: number | null;
          care_note?: string | null;
          care_occurred_at: string;
          care_time_zone: string;
          target_care_log_id: string;
        };
        Returns: Database['public']['Tables']['care_logs']['Row'];
      };
      update_care_task: {
        Args: {
          target_task_id: string;
          task_care_type: Database['public']['Enums']['care_type'] | null;
          task_local_time: string | null;
          task_month_day: number | null;
          task_note: string | null;
          task_schedule_type: Database['public']['Enums']['care_task_schedule_type'];
          task_scheduled_at: string | null;
          task_starts_on: string | null;
          task_time_zone: string;
          task_title: string;
          task_week_day: number | null;
        };
        Returns: Database['public']['Tables']['care_tasks']['Row'];
      };
      update_care_shift: {
        Args: {
          shift_note: string | null;
          target_assignee_user_id: string | null;
          target_shift_id: string;
        };
        Returns: Database['public']['Tables']['care_shifts']['Row'];
      };
      undo_care_task_completion: {
        Args: { target_completion_id: string };
        Returns: 'undone' | 'not_found';
      };
    };
    Enums: {
      care_schedule_status: 'scheduled' | 'canceled';
      care_task_schedule_type: 'once' | 'daily' | 'weekly' | 'monthly';
      care_type:
        'feeding' | 'walk' | 'medicine' | 'bath' | 'grooming' | 'other';
      pet_gender: 'male' | 'female' | 'unknown';
      pet_member_role: 'owner' | 'member' | 'viewer';
      pet_species: 'dog' | 'cat' | 'other';
      post_tag:
        | 'walk'
        | 'meal'
        | 'sleep'
        | 'play'
        | 'grooming'
        | 'vet'
        | 'birthday'
        | 'travel'
        | 'other';
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
export type ChatReadState =
  Database['public']['Tables']['chat_read_states']['Row'];
export type CareLog = Database['public']['Tables']['care_logs']['Row'];
export type CareShift = Database['public']['Tables']['care_shifts']['Row'];
export type CareShiftTask =
  Database['public']['Tables']['care_shift_tasks']['Row'];
export type CareScheduleStatus =
  Database['public']['Enums']['care_schedule_status'];
export type CareTask = Database['public']['Tables']['care_tasks']['Row'];
export type CareTaskCompletion =
  Database['public']['Tables']['care_task_completions']['Row'];
export type CareTaskScheduleType =
  Database['public']['Enums']['care_task_schedule_type'];
export type CareType = Database['public']['Enums']['care_type'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
export type PetInvite = Database['public']['Tables']['pet_invites']['Row'];
export type Pet = Database['public']['Tables']['pets']['Row'];
export type PetUpdate = Database['public']['Tables']['pets']['Update'];
export type PetGender = Database['public']['Enums']['pet_gender'];
export type PetSpecies = Database['public']['Enums']['pet_species'];
export type PetMemberRole = Database['public']['Enums']['pet_member_role'];
export type Post = Database['public']['Tables']['posts']['Row'];
export type PostMedia = Database['public']['Tables']['post_media']['Row'];
export type PostTag = Database['public']['Enums']['post_tag'];
