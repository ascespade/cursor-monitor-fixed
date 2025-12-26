# خطة التحويل: Chatwoot-Style Architecture مع Next.js
# Migration Plan: Chatwoot-Style Architecture with Next.js

## ✅ الإجابة المختصرة / Short Answer

**نعم، ممكن تماماً!** يمكن تحويل المشروع ليطابق بنية Chatwoot مع الحفاظ على Next.js.

---

## 🎯 الهدف / Objective

تحويل **Cursor Monitor** ليطابق **Chatwoot** في:
- ✅ البنية المعمارية (Architecture Patterns)
- ✅ أنماط التصميم (Design Patterns)
- ✅ هيكل الكود (Code Structure)
- ✅ معالجة المهام (Job Processing)
- ✅ نظام الأذونات (Authorization)
- ✅ Multi-tenancy
- ❌ **لكن مع الحفاظ على Next.js** (بدلاً من Rails)

---

## 📋 خطة التحويل / Migration Plan

### المرحلة 1: البنية الأساسية / Phase 1: Core Infrastructure

#### 1.1 Models Layer (مكافئ ActiveRecord)

**Chatwoot Pattern:**
```ruby
# app/models/conversation.rb
class Conversation < ApplicationRecord
  belongs_to :account
  belongs_to :inbox
  has_many :messages
  scope :open, -> { where(status: 'open') }
end
```

**Next.js Equivalent:**
```typescript
// src/core/domain/entities/conversation.entity.ts
export interface Conversation {
  id: string
  accountId: string
  inboxId: string
  status: 'open' | 'resolved' | 'pending'
  createdAt: Date
  updatedAt: Date
}

// src/infrastructure/supabase/repositories/conversation.repository.ts
export class ConversationRepository {
  async findByAccount(accountId: string): Promise<Conversation[]> {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
    return data.map(this.mapToEntity)
  }

  async findOpen(accountId: string): Promise<Conversation[]> {
    return this.findByAccount(accountId).then(
      convs => convs.filter(c => c.status === 'open')
    )
  }
}
```

**التحويل:**
- ✅ إنشاء `src/core/domain/entities/` لكل Model
- ✅ إنشاء `src/infrastructure/supabase/repositories/` لكل Repository
- ✅ استخدام TypeScript interfaces بدلاً من Ruby classes
- ✅ استخدام Supabase queries بدلاً من ActiveRecord

---

#### 1.2 Services Layer (Service Objects Pattern)

**Chatwoot Pattern:**
```ruby
# app/services/conversations/mark_as_resolved_service.rb
class Conversations::MarkAsResolvedService
  def initialize(conversation:, user:)
    @conversation = conversation
    @user = user
  end

  def perform
    @conversation.update!(status: 'resolved')
    create_activity_message
    notify_participants
  end

  private

  def create_activity_message
    # ...
  end

  def notify_participants
    # ...
  end
end
```

**Next.js Equivalent:**
```typescript
// src/features/conversations/services/mark-as-resolved.service.ts
export class MarkAsResolvedService {
  constructor(
    private conversationRepo: IConversationRepository,
    private messageService: IMessageService,
    private notificationService: INotificationService
  ) {}

  async execute(
    conversationId: string,
    userId: string
  ): Promise<Conversation> {
    // 1. Update conversation
    const conversation = await this.conversationRepo.update(conversationId, {
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy: userId
    })

    // 2. Create activity message
    await this.messageService.createActivityMessage({
      conversationId,
      type: 'conversation_resolved',
      userId
    })

    // 3. Notify participants
    await this.notificationService.notifyConversationResolved(conversationId)

    return conversation
  }
}
```

**التحويل:**
- ✅ إنشاء `src/features/[feature]/services/` لكل Service
- ✅ استخدام Dependency Injection
- ✅ كل Service = class مع method `execute()` أو `perform()`
- ✅ Services تستخدم Repositories (ليس Supabase مباشرة)

---

#### 1.3 Policies Layer (Pundit Pattern)

**Chatwoot Pattern:**
```ruby
# app/policies/conversation_policy.rb
class ConversationPolicy < ApplicationPolicy
  def show?
    account_user.present? && record.account_id == account.id
  end

  def update?
    account_user.administrator? || 
    (account_user.agent? && record.assignee_id == user.id)
  end
end

# Usage in controller
def show
  authorize @conversation
  # ...
end
```

**Next.js Equivalent:**
```typescript
// src/core/security/policies/conversation.policy.ts
export class ConversationPolicy {
  constructor(
    private user: User,
    private accountUser: AccountUser,
    private conversation: Conversation
  ) {}

  canShow(): boolean {
    return !!this.accountUser && 
           this.conversation.accountId === this.accountUser.accountId
  }

  canUpdate(): boolean {
    if (this.accountUser.role === 'administrator') return true
    if (this.accountUser.role === 'agent') {
      return this.conversation.assigneeId === this.user.id
    }
    return false
  }

  canDelete(): boolean {
    return this.accountUser.role === 'administrator'
  }
}

// src/core/security/middleware/authorize.middleware.ts
export async function authorize<T>(
  user: User,
  accountUser: AccountUser,
  resource: T,
  action: string
): Promise<void> {
  const policy = getPolicyForResource(resource)
  const canPerform = policy[`can${capitalize(action)}`]?.()

  if (!canPerform) {
    throw new ForbiddenError(`User cannot ${action} this resource`)
  }
}
```

**التحويل:**
- ✅ إنشاء `src/core/security/policies/` لكل Policy
- ✅ إنشاء `authorize()` middleware للـ API routes
- ✅ استخدام في كل API route قبل العملية

---

#### 1.4 Jobs Layer (Sidekiq Pattern)

**Chatwoot Pattern:**
```ruby
# app/jobs/process_message_job.rb
class ProcessMessageJob < ApplicationJob
  queue_as :default

  def perform(message_id)
    message = Message.find(message_id)
    Messages::ProcessService.new(message: message).perform
  end
end

# Usage
ProcessMessageJob.perform_async(message.id)
```

**Next.js Equivalent:**
```typescript
// src/core/jobs/base-job.ts
export abstract class BaseJob<T = unknown> {
  abstract queueName: string
  abstract execute(data: T): Promise<void>

  async perform(data: T): Promise<void> {
    try {
      await this.execute(data)
    } catch (error) {
      await this.handleError(error, data)
      throw error
    }
  }

  protected async handleError(error: Error, data: T): Promise<void> {
    // Log error, retry logic, etc.
  }
}

// src/features/messages/jobs/process-message.job.ts
export class ProcessMessageJob extends BaseJob<{ messageId: string }> {
  queueName = 'default'

  constructor(
    private messageService: IMessageService
  ) {
    super()
  }

  async execute(data: { messageId: string }): Promise<void> {
    await this.messageService.processMessage(data.messageId)
  }
}

// Usage
await jobQueue.enqueue(ProcessMessageJob, { messageId: message.id })
```

**التحويل:**
- ✅ إنشاء `src/core/jobs/base-job.ts`
- ✅ إنشاء `src/features/[feature]/jobs/` لكل Job
- ✅ استخدام BullMQ مع Job classes
- ✅ Job processing في worker container

---

### المرحلة 2: Controllers → API Routes / Phase 2: Controllers to API Routes

#### 2.1 RESTful Controllers Pattern

**Chatwoot Pattern:**
```ruby
# app/controllers/api/v1/conversations_controller.rb
class Api::V1::ConversationsController < Api::V1::ApiController
  before_action :authenticate_user!
  before_action :set_conversation, only: [:show, :update, :destroy]

  def index
    @conversations = current_account.conversations
    render json: @conversations
  end

  def show
    authorize @conversation
    render json: @conversation
  end

  def create
    @conversation = Conversations::CreateService.new(
      params: conversation_params,
      user: current_user
    ).perform
    render json: @conversation, status: :created
  end

  def update
    authorize @conversation
    @conversation = Conversations::UpdateService.new(
      conversation: @conversation,
      params: conversation_params
    ).perform
    render json: @conversation
  end

  private

  def set_conversation
    @conversation = current_account.conversations.find(params[:id])
  end

  def conversation_params
    params.require(:conversation).permit(:status, :assignee_id)
  end
end
```

**Next.js Equivalent:**
```typescript
// app/api/v1/conversations/route.ts
import { withAuth } from '@/core/api/middleware/auth.middleware'
import { authorize } from '@/core/security/middleware/authorize.middleware'
import { ConversationRepository } from '@/infrastructure/supabase/repositories'
import { CreateConversationService } from '@/features/conversations/services'
import { conversationSchema } from '@/features/conversations/validations'

export const GET = withAuth(async (req: Request, { user, accountUser }) => {
  const repo = new ConversationRepository()
  const conversations = await repo.findByAccount(accountUser.accountId)
  
  return Response.json({ data: conversations })
})

export const POST = withAuth(async (req: Request, { user, accountUser }) => {
  const body = await req.json()
  const validated = conversationSchema.parse(body)

  const service = new CreateConversationService()
  const conversation = await service.execute({
    ...validated,
    accountId: accountUser.accountId,
    createdBy: user.id
  })

  return Response.json({ data: conversation }, { status: 201 })
})

// app/api/v1/conversations/[id]/route.ts
export const GET = withAuth(async (
  req: Request,
  { user, accountUser, params }
) => {
  const repo = new ConversationRepository()
  const conversation = await repo.findById(params.id)

  if (!conversation) {
    throw new NotFoundError('Conversation not found')
  }

  await authorize(user, accountUser, conversation, 'show')

  return Response.json({ data: conversation })
})

export const PATCH = withAuth(async (
  req: Request,
  { user, accountUser, params }
) => {
  const repo = new ConversationRepository()
  const conversation = await repo.findById(params.id)

  if (!conversation) {
    throw new NotFoundError('Conversation not found')
  }

  await authorize(user, accountUser, conversation, 'update')

  const body = await req.json()
  const validated = conversationSchema.partial().parse(body)

  const service = new UpdateConversationService()
  const updated = await service.execute(params.id, validated)

  return Response.json({ data: updated })
})
```

**التحويل:**
- ✅ إنشاء `app/api/v1/[resource]/route.ts` لكل resource
- ✅ استخدام `withAuth` middleware
- ✅ استخدام `authorize` قبل العمليات
- ✅ استخدام Services بدلاً من logic مباشر
- ✅ استخدام Zod schemas للـ validation

---

### المرحلة 3: Multi-tenancy / Phase 3: Multi-tenancy

#### 3.1 Account-based Multi-tenancy

**Chatwoot Pattern:**
```ruby
# app/models/account.rb
class Account < ApplicationRecord
  has_many :users, through: :account_users
  has_many :conversations
  has_many :inboxes
end

# app/models/account_user.rb
class AccountUser < ApplicationRecord
  belongs_to :account
  belongs_to :user
  enum role: { administrator: 0, agent: 1, viewer: 2 }
end

# Usage in controller
def current_account
  @current_account ||= current_user.accounts.find(params[:account_id])
end
```

**Next.js Equivalent:**
```typescript
// src/core/domain/entities/account.entity.ts
export interface Account {
  id: string
  name: string
  createdAt: Date
}

// src/core/domain/entities/account-user.entity.ts
export interface AccountUser {
  id: string
  accountId: string
  userId: string
  role: 'administrator' | 'agent' | 'viewer'
  createdAt: Date
}

// src/core/api/middleware/auth.middleware.ts
export async function withAuth(
  handler: (req: Request, context: AuthContext) => Promise<Response>
) {
  return async (req: Request, context: any) => {
    // 1. Authenticate user
    const user = await authenticateUser(req)
    
    // 2. Get account from header or query
    const accountId = req.headers.get('X-Account-Id') || 
                     new URL(req.url).searchParams.get('account_id')
    
    if (!accountId) {
      throw new BadRequestError('Account ID required')
    }

    // 3. Get account user
    const accountUser = await getAccountUser(user.id, accountId)
    if (!accountUser) {
      throw new ForbiddenError('User not member of account')
    }

    // 4. Call handler with context
    return handler(req, {
      user,
      account: await getAccount(accountId),
      accountUser
    })
  }
}
```

**التحويل:**
- ✅ إضافة `accounts` table
- ✅ إضافة `account_users` table (many-to-many)
- ✅ كل resource له `account_id`
- ✅ كل query يفلتر بـ `account_id`
- ✅ Policies تتحقق من `account_id`

---

### المرحلة 4: Background Jobs / Phase 4: Background Jobs

#### 4.1 Sidekiq → BullMQ Migration

**Chatwoot Pattern:**
```ruby
# app/jobs/application_job.rb
class ApplicationJob < ActiveJob::Base
  queue_as :default
  retry_on StandardError, wait: :exponentially_longer, attempts: 3
end

# app/jobs/process_webhook_job.rb
class ProcessWebhookJob < ApplicationJob
  def perform(webhook_id)
    webhook = Webhook.find(webhook_id)
    Webhooks::ProcessService.new(webhook: webhook).perform
  end
end

# Usage
ProcessWebhookJob.perform_async(webhook.id)
ProcessWebhookJob.perform_in(5.minutes, webhook.id)
```

**Next.js Equivalent:**
```typescript
// src/core/jobs/base-job.ts
export abstract class BaseJob<T = unknown> {
  abstract queueName: string
  abstract execute(data: T): Promise<void>

  async perform(data: T, options?: JobOptions): Promise<void> {
    // Implementation
  }
}

// src/features/webhooks/jobs/process-webhook.job.ts
export class ProcessWebhookJob extends BaseJob<{ webhookId: string }> {
  queueName = 'default'

  constructor(
    private webhookService: IWebhookService
  ) {
    super()
  }

  async execute(data: { webhookId: string }): Promise<void> {
    await this.webhookService.processWebhook(data.webhookId)
  }
}

// src/core/queue/job-queue.ts
export class JobQueue {
  private queues: Map<string, Queue> = new Map()

  async enqueue<T>(
    JobClass: new (...args: any[]) => BaseJob<T>,
    data: T,
    options?: JobOptions
  ): Promise<void> {
    const job = new JobClass()
    const queue = this.getQueue(job.queueName)
    
    await queue.add(job.constructor.name, data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      ...options
    })
  }

  async enqueueIn<T>(
    JobClass: new (...args: any[]) => BaseJob<T>,
    data: T,
    delay: number
  ): Promise<void> {
    await this.enqueue(JobClass, data, { delay })
  }
}

// Usage
await jobQueue.enqueue(ProcessWebhookJob, { webhookId: webhook.id })
await jobQueue.enqueueIn(ProcessWebhookJob, { webhookId: webhook.id }, 5 * 60 * 1000)
```

**التحويل:**
- ✅ إنشاء `BaseJob` abstract class
- ✅ إنشاء `JobQueue` service
- ✅ استخدام BullMQ مع Job classes
- ✅ Worker container يعالج Jobs

---

### المرحلة 5: Real-time / Phase 5: Real-time

#### 5.1 ActionCable → WebSocket/Supabase Realtime

**Chatwoot Pattern:**
```ruby
# app/channels/conversation_channel.rb
class ConversationChannel < ApplicationCable::Channel
  def subscribed
    stream_from "conversation_#{params[:id]}"
  end

  def receive(data)
    ActionCable.server.broadcast(
      "conversation_#{params[:id]}",
      data
    )
  end
end

# Usage in service
ActionCable.server.broadcast(
  "conversation_#{conversation.id}",
  { type: 'message.created', data: message }
)
```

**Next.js Equivalent:**
```typescript
// Option 1: Supabase Realtime (Recommended)
// src/features/conversations/hooks/use-conversation-realtime.ts
export function useConversationRealtime(conversationId: string) {
  const supabase = createClientComponentClient()

  useEffect(() => {
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        // Handle message updates
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])
}

// Option 2: Custom WebSocket Server
// src/core/realtime/websocket-server.ts
export class WebSocketServer {
  private channels: Map<string, Set<WebSocket>> = new Map()

  subscribe(channel: string, ws: WebSocket): void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set())
    }
    this.channels.get(channel)!.add(ws)
  }

  broadcast(channel: string, data: unknown): void {
    const subscribers = this.channels.get(channel)
    if (!subscribers) return

    const message = JSON.stringify(data)
    subscribers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    })
  }
}

// Usage in service
realtimeServer.broadcast(`conversation:${conversationId}`, {
  type: 'message.created',
  data: message
})
```

**التحويل:**
- ✅ استخدام Supabase Realtime (أسهل)
- ✅ أو إنشاء WebSocket server مخصص
- ✅ Broadcast events من Services

---

## 📁 البنية النهائية / Final Structure

```
cursor-monitor/
├── app/                          # Next.js App Router (thin layer)
│   ├── api/
│   │   └── v1/
│   │       ├── conversations/
│   │       │   ├── route.ts      # GET, POST
│   │       │   └── [id]/
│   │       │       ├── route.ts  # GET, PATCH, DELETE
│   │       │       └── messages/
│   │       │           └── route.ts
│   │       └── accounts/
│   ├── (auth)/
│   └── (dashboard)/
│
├── src/
│   ├── core/
│   │   ├── domain/
│   │   │   └── entities/         # Models (TypeScript interfaces)
│   │   │       ├── account.entity.ts
│   │   │       ├── conversation.entity.ts
│   │   │       └── message.entity.ts
│   │   ├── interfaces/
│   │   │   ├── repositories/     # Repository contracts
│   │   │   ├── services/         # Service contracts
│   │   │   └── jobs/             # Job contracts
│   │   ├── security/
│   │   │   ├── policies/         # Pundit-style policies
│   │   │   │   ├── conversation.policy.ts
│   │   │   │   └── message.policy.ts
│   │   │   └── middleware/
│   │   │       ├── auth.middleware.ts
│   │   │       └── authorize.middleware.ts
│   │   ├── jobs/
│   │   │   └── base-job.ts       # BaseJob class
│   │   └── queue/
│   │       └── job-queue.ts      # JobQueue service
│   │
│   ├── infrastructure/
│   │   ├── supabase/
│   │   │   └── repositories/     # Repository implementations
│   │   │       ├── account.repository.ts
│   │   │       ├── conversation.repository.ts
│   │   │       └── message.repository.ts
│   │   └── queue/
│   │       └── bullmq-queue.ts   # BullMQ implementation
│   │
│   ├── features/
│   │   ├── conversations/
│   │   │   ├── services/         # Service objects
│   │   │   │   ├── create-conversation.service.ts
│   │   │   │   ├── update-conversation.service.ts
│   │   │   │   └── mark-as-resolved.service.ts
│   │   │   ├── jobs/             # Background jobs
│   │   │   │   └── process-conversation.job.ts
│   │   │   ├── validations/      # Zod schemas
│   │   │   │   └── conversation.validations.ts
│   │   │   └── hooks/            # React hooks
│   │   │       └── use-conversation-realtime.ts
│   │   ├── messages/
│   │   ├── accounts/
│   │   └── auth/
│   │
│   └── shared/
│       ├── components/
│       ├── utils/
│       └── types/
│
└── orchestrator/                 # Worker container
    └── src/
        └── workers/
            └── job-processor.worker.ts
```

---

## 🔄 خطوات التنفيذ / Implementation Steps

### Step 1: إعداد البنية الأساسية
1. ✅ إنشاء `BaseJob` class
2. ✅ إنشاء `JobQueue` service
3. ✅ إنشاء `withAuth` middleware
4. ✅ إنشاء `authorize` middleware
5. ✅ إنشاء `BasePolicy` class

### Step 2: تحويل Models → Entities + Repositories
1. ✅ إنشاء TypeScript interfaces لكل Model
2. ✅ إنشاء Repository classes
3. ✅ استخدام Repositories في Services

### Step 3: تحويل Services
1. ✅ إنشاء Service classes
2. ✅ استخدام Dependency Injection
3. ✅ نقل Business Logic إلى Services

### Step 4: تحويل Controllers → API Routes
1. ✅ إنشاء API routes
2. ✅ استخدام `withAuth` middleware
3. ✅ استخدام `authorize` قبل العمليات
4. ✅ استخدام Services بدلاً من logic مباشر

### Step 5: إضافة Multi-tenancy
1. ✅ إضافة `accounts` table
2. ✅ إضافة `account_users` table
3. ✅ تحديث كل Repository ليفلتر بـ `account_id`
4. ✅ تحديث Policies للتحقق من `account_id`

### Step 6: تحويل Background Jobs
1. ✅ تحويل كل Job إلى TypeScript class
2. ✅ استخدام BullMQ
3. ✅ إعداد Worker container

### Step 7: Real-time Communication
1. ✅ إعداد Supabase Realtime
2. ✅ إنشاء React hooks للـ subscriptions
3. ✅ Broadcast events من Services

---

## ⚠️ التحديات / Challenges

### 1. TypeScript vs Ruby
- **Chatwoot**: Dynamic typing, metaprogramming
- **Next.js**: Static typing, explicit types
- **الحل**: استخدام TypeScript generics و interfaces

### 2. ActiveRecord vs Supabase
- **Chatwoot**: ActiveRecord ORM (rich features)
- **Next.js**: Supabase client (simpler)
- **الحل**: بناء Repository layer مع helper methods

### 3. Sidekiq vs BullMQ
- **Chatwoot**: Sidekiq (Ruby)
- **Next.js**: BullMQ (Node.js)
- **الحل**: استخدام Job classes مع BullMQ

### 4. ActionCable vs WebSocket
- **Chatwoot**: ActionCable (Rails)
- **Next.js**: Supabase Realtime أو WebSocket
- **الحل**: استخدام Supabase Realtime (أسهل)

---

## ✅ الخلاصة / Conclusion

**نعم، ممكن تماماً!** يمكن تحويل المشروع ليطابق Chatwoot مع:

✅ **الحفاظ على Next.js**  
✅ **استخدام نفس الأنماط** (Services, Policies, Jobs)  
✅ **نفس البنية** (Models → Entities + Repositories)  
✅ **نفس Multi-tenancy**  
✅ **نفس Background Jobs** (BullMQ بدلاً من Sidekiq)  

**الفرق الوحيد**: Next.js + TypeScript بدلاً من Rails + Ruby

---

**تاريخ الخطة**: 2024-12-21  
**الحالة**: جاهز للتنفيذ ✅



