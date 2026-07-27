export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string;
          emoji: string;
          id: string;
          name: string;
          slug: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          emoji: string;
          id?: string;
          name: string;
          slug: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          id?: string;
          name?: string;
          slug?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          client_id: string;
          created_at: string;
          id: string;
          last_message_at: string;
          pal_id: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          id?: string;
          last_message_at?: string;
          pal_id: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          id?: string;
          last_message_at?: string;
          pal_id?: string;
        };
        Relationships: [];
      };
      credit_transactions: {
        Row: {
          cents_amount: number;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["tx_kind"];
          note: string | null;
          seconds_delta: number;
          session_id: string | null;
          stripe_reference: string | null;
          user_id: string;
        };
        Insert: {
          cents_amount?: number;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["tx_kind"];
          note?: string | null;
          seconds_delta: number;
          session_id?: string | null;
          stripe_reference?: string | null;
          user_id: string;
        };
        Update: {
          cents_amount?: number;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["tx_kind"];
          note?: string | null;
          seconds_delta?: number;
          session_id?: string | null;
          stripe_reference?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_transactions_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          sender_id: string;
        };
        Insert: {
          body: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          sender_id: string;
        };
        Update: {
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      pat_pals: {
        Row: {
          availability: Database["public"]["Enums"]["availability_status"];
          category_slugs: string[];
          created_at: string;
          headline: string | null;
          is_team: boolean;
          price_cents_per_minute: number;
          rating_avg: number;
          rating_count: number;
          service_range: string | null;
          tier: Database["public"]["Enums"]["pal_tier"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          availability?: Database["public"]["Enums"]["availability_status"];
          category_slugs?: string[];
          created_at?: string;
          headline?: string | null;
          is_team?: boolean;
          price_cents_per_minute?: number;
          rating_avg?: number;
          rating_count?: number;
          service_range?: string | null;
          tier?: Database["public"]["Enums"]["pal_tier"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          availability?: Database["public"]["Enums"]["availability_status"];
          category_slugs?: string[];
          created_at?: string;
          headline?: string | null;
          is_team?: boolean;
          price_cents_per_minute?: number;
          rating_avg?: number;
          rating_count?: number;
          service_range?: string | null;
          tier?: Database["public"]["Enums"]["pal_tier"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profile_contacts: {
        Row: {
          phone: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          phone?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          phone?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          full_name: string;
          id: string;
          introduction: string | null;
          is_active: boolean;
          languages: string[];
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          full_name?: string;
          id: string;
          introduction?: string | null;
          is_active?: boolean;
          languages?: string[];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          introduction?: string | null;
          is_active?: boolean;
          languages?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
      promo_banners: {
        Row: {
          body: string | null;
          created_at: string;
          cta_href: string | null;
          cta_label: string | null;
          id: string;
          is_visible: boolean;
          sort_order: number;
          title: string;
          updated_at: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          cta_href?: string | null;
          cta_label?: string | null;
          id?: string;
          is_visible?: boolean;
          sort_order?: number;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          cta_href?: string | null;
          cta_label?: string | null;
          id?: string;
          is_visible?: boolean;
          sort_order?: number;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          client_id: string;
          comment: string | null;
          created_at: string;
          id: string;
          pal_id: string;
          session_id: string;
          stars: number;
        };
        Insert: {
          client_id: string;
          comment?: string | null;
          created_at?: string;
          id?: string;
          pal_id: string;
          session_id: string;
          stars: number;
        };
        Update: {
          client_id?: string;
          comment?: string | null;
          created_at?: string;
          id?: string;
          pal_id?: string;
          session_id?: string;
          stars?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ratings_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          client_id: string;
          connected_at: string | null;
          conversation_id: string | null;
          cost_cents: number;
          ended_at: string | null;
          id: string;
          kind: Database["public"]["Enums"]["session_kind"];
          pal_id: string;
          price_cents_per_minute: number;
          remaining_seconds_at_start: number;
          seconds_used: number;
          started_at: string;
          status: Database["public"]["Enums"]["session_status"];
        };
        Insert: {
          client_id: string;
          connected_at?: string | null;
          conversation_id?: string | null;
          cost_cents?: number;
          ended_at?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["session_kind"];
          pal_id: string;
          price_cents_per_minute: number;
          remaining_seconds_at_start?: number;
          seconds_used?: number;
          started_at?: string;
          status?: Database["public"]["Enums"]["session_status"];
        };
        Update: {
          client_id?: string;
          connected_at?: string | null;
          conversation_id?: string | null;
          cost_cents?: number;
          ended_at?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["session_kind"];
          pal_id?: string;
          price_cents_per_minute?: number;
          remaining_seconds_at_start?: number;
          seconds_used?: number;
          started_at?: string;
          status?: Database["public"]["Enums"]["session_status"];
        };
        Relationships: [
          {
            foreignKeyName: "sessions_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      trial_codes: {
        Row: {
          code: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          label: string | null;
          unlimited: boolean;
        };
        Insert: {
          code: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string | null;
          unlimited?: boolean;
        };
        Update: {
          code?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string | null;
          unlimited?: boolean;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          balance_seconds: number;
          unlimited_until: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance_seconds?: number;
          unlimited_until?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          balance_seconds?: number;
          unlimited_until?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          introduction: string | null;
          languages: string[] | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      apply_trial_code: {
        Args: {
          p_user_id: string;
          p_seconds: number;
          p_unlimited_until: string | null;
          p_note: string;
        };
        Returns: undefined;
      };
      cancel_session_before_connect: {
        Args: {
          p_session_id: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      credit_wallet: {
        Args: {
          p_user_id: string;
          p_seconds: number;
          p_cents_amount: number;
          p_stripe_ref: string;
          p_note: string;
        };
        Returns: undefined;
      };
      debit_wallet: {
        Args: {
          p_user_id: string;
          p_session_id: string;
          p_seconds: number;
          p_cost_cents: number;
          p_note: string;
        };
        Returns: undefined;
      };
      end_session_billing: {
        Args: {
          p_session_id: string;
          p_actor_id: string;
          p_seconds: number;
          p_cost_cents: number;
          p_note: string;
        };
        Returns: { new_balance: number }[];
      };
      extend_session_billing_cap: {
        Args: {
          p_session_id: string;
          p_seconds: number;
        };
        Returns: undefined;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      refund_wallet: {
        Args: {
          p_user_id: string;
          p_seconds: number;
          p_cents_amount: number;
          p_stripe_ref: string;
          p_note: string;
        };
        Returns: undefined;
      };
      mark_session_connected: {
        Args: {
          p_session_id: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "client" | "pat_pal" | "admin" | "super_admin";
      availability_status: "available" | "busy" | "offline";
      pal_tier: "trusted" | "expert" | "premium";
      session_kind: "chat" | "audio" | "video";
      session_status: "active" | "ended" | "cancelled";
      tx_kind: "purchase" | "debit" | "refund" | "trial";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["client", "pat_pal", "admin", "super_admin"],
      availability_status: ["available", "busy", "offline"],
      pal_tier: ["trusted", "expert", "premium"],
      session_kind: ["chat", "audio", "video"],
      session_status: ["active", "ended", "cancelled"],
      tx_kind: ["purchase", "debit", "refund", "trial"],
    },
  },
} as const;
