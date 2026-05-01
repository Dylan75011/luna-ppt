// OpenAI function calling 工具定义（纯 schema，无执行逻辑）

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_images',
      description: '从图库中搜索现有图片素材，包括参考图、氛围图、展台效果图、海报视觉参考等。注意：这是搜索已有图片，不是 AI 生成图片。适用于"找图/搜图/配图/来点参考图"等请求；不适用于"生成图/画一张/AI作图"等需要创作全新图像的请求。如果用户想找某个品牌官网的图（如"华为官网""小米官网"），可用 site 参数指定域名。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜图关键词，尽量描述主体、场景、风格和用途，例如"车展展台 科技感 概念氛围图"' },
          intent: { type: 'string', description: '用户想找什么图，例如"车展展台参考图""PPT背景图""KV 灵感图"' },
          site: { type: 'string', description: '可选。限定搜索来源域名，例如 "huawei.com"、"mi.com"、"apple.com"。适合用户说"从华为官网找图""小米官网的产品图"时使用。' },
          max_results: { type: 'number', description: '最多返回图片数，默认 8，建议 4-12' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '使用 MiniMax AI 生成一张全新的图片。适用于用户明确说"生成图/画一张/AI生图/重新生成这张/换一张"的场景。生成结果会直接展示在对话中。注意：生成图片约需 10-20 秒，请提前告知用户。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述，英文，50字以内。描述主体、风格、氛围，例如：dark cinematic stage with volumetric light beams, moody atmosphere, 16:9' },
          intent: { type: 'string', description: '用户想要的图片用途，例如"发布会封面图""活动现场效果图""展台概念图"，用于展示给用户看' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_todos',
      description: '写入或更新当前任务计划。用于复杂任务，把待办拆成 3-6 个步骤，并持续更新状态。',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '待办内容，简洁具体' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: '待办状态'
                }
              },
              required: ['content', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_brief',
      description: '更新当前任务简报，把已确认或保守假设的关键信息结构化保存，便于后续策划和展示。',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          productCategory: { type: 'string' },
          eventType: { type: 'string', enum: ['product_launch', 'auto_show', 'exhibition', 'meeting', 'simple', ''] },
          topic: { type: 'string' },
          goal: { type: 'string' },
          audience: { type: 'string' },
          scale: { type: 'string' },
          budget: { type: 'string' },
          style: { type: 'string' },
          tone: { type: 'string' },
          requirements: { type: 'string' },
          assumptions: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'challenge_brief',
      description: '用"资深策划总监"视角审视当前 brief，专门找红旗/硬伤/潜在冲突（预算 vs 目标不匹配、调性 vs 受众冲突、"既要又要"、关键信息缺失等）。**调用时机：update_brief 之后、web_search 或 propose_concept 之前**，只需要一次（除非 brief 有重大调整）。约 5-10 秒，如果有 concerns 会渲染质疑卡片到对话里让用户看到；没问题会直接放行。这是 Agent 主动给用户"泼冷水"的机制，避免默默按有问题的 brief 做下去。',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '可选：本次审视的重点方向，例如"重点看预算合理性"。不传则通用扫描。' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'review_uploaded_images',
      description: '重新查看本次对话里用户上传过的图片，并按当前问题提取关键信息、风格线索或识别图中内容。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '这次希望重点看什么，比如"识别品牌和产品"、"总结视觉风格"、"看海报里的关键信息"' },
          image_ids: {
            type: 'array',
            description: '可选。指定要查看的图片 ID；不传则默认查看最近上传的全部图片',
            items: { type: 'string' }
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索网页，获取行业动态、竞品案例、创意形式、市场数据等信息。**通用网页搜索的唯一入口**——内部已自动级联：优先走本地 Chrome 扩展的 Bing 登录态搜索（结果干净、无 quota），扩展不可用时自动 fallback 到 Tavily/MiniMax 多源 + DuckDuckGo 兜底。你不需要判断走哪条路。返回 source 字段标明实际来源（browser:bing / minimax+tavily / ddg）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，中文英文均可' },
          max_results: { type: 'number', description: '最多返回条数，默认5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '读取指定网页的完整内容，适合深度了解某篇报道、案例或行业文章',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要读取的网页 URL' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_search',
      description: '**仅用于站内平台搜索**（目前只支持小红书 xiaohongshu）。通用网页搜索请用 web_search（已自动走扩展 Bing）。本工具以用户登录态在小红书内搜笔记列表（标题/作者/点赞数/封面，5-10 秒出结果）。**推荐工作流**：先用这个看 10 条标题+作者，自行判断哪几条质量高/角度对路，然后用 browser_read_notes 批量抓这几条的正文；不要默认抓全部正文。也可通过 fetch_body_top_n 让本工具顺带把前 N 条正文一并抓回来（每条约多 3-4 秒），但通常不如先看标题再挑有针对性。使用前提：用户已在 Chrome 里加载 Luna 扩展并登录对应平台。结果累积到 researchStore。',
      parameters: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['xiaohongshu'],
            description: '目标平台。当前仅支持 xiaohongshu（小红书）。'
          },
          query: { type: 'string', description: '搜索关键词，中文英文均可' },
          max_results: { type: 'number', description: '返回的笔记条数，默认 10，上限 30' },
          fetch_body_top_n: { type: 'number', description: '可选：让本工具顺带对前 N 条抓正文，默认 0（只要列表）。若你确定不需要挑选、要无脑抓全部，再设为 5-10。通常建议保持 0，用 browser_read_notes 挑着抓。' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_read_notes',
      description: '批量抓取一组已知 URL 对应笔记的正文（小红书详情页）。用在 browser_search 之后：你看完 10 条标题+作者，挑出 3-5 条最相关的，把它们的 url 传进来，一次性拿到每条的正文、标签、完整标题。比挨个调 browser_read_page 快，且 agent 侧只占一次工具轮次。每条约 3-4 秒，最多 10 条。',
      parameters: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['xiaohongshu'],
            description: '目标平台。当前仅支持 xiaohongshu（小红书）。'
          },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: '要抓正文的笔记 URL 列表（必须从上一次 browser_search 的结果里 copy，不要自己拼 URL——原链接里的 xsec_token 等参数对登录态解锁正文很关键）。最多 10 条。'
          }
        },
        required: ['urls']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyze_note_images',
      description: '用视觉模型看懂小红书笔记的图片。**首选传 note_url**——只传你之前 browser_read_notes 读过的那条笔记 URL 就行，后端自己从缓存取 images[]，省得你复制长 URL 容易截断。一条笔记一次性把全部图都看了（小红书最多 9 张），不要分批。',
      parameters: {
        type: 'object',
        properties: {
          note_url: {
            type: 'string',
            description: '【首选】小红书笔记 URL，必须是之前调用过 browser_read_notes 读过的那条。后端会从缓存里取这条笔记的全部图片（含视频封面）做分析，你不用复制 image_urls。'
          },
          image_indexes: {
            type: 'array',
            items: { type: 'number' },
            description: '可选：只分析特定索引的图（0 起步）。不传就是全部。一般不需要传。'
          },
          image_urls: {
            type: 'array',
            items: { type: 'string' },
            description: '【兜底】当 note_url 不可用时直传图片 URL。**不推荐**：长 URL 复制容易出错。'
          },
          question: {
            type: 'string',
            description: '你想让视觉模型重点回答什么，比如"提取图里出现的品牌名和活动名"、"描述展台的视觉风格和氛围"、"识别图里的文字内容"。越具体越省 token。'
          },
          note_title: {
            type: 'string',
            description: '可选：笔记标题，给视觉模型一点上下文会更准。传 note_url 时后端会自动填，可不传。'
          }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_read_page',
      description: '通过本地 Chrome 扩展，以用户登录态读取指定 URL 的完整可见文本（走真实渲染路径，绕过一部分反爬和登录门槛）。适合 web_search 之后对 Top 结果取全文。返回值带 meta.lowSignal/loginWall/charCount——看到 lowSignal:true 说明这条页面要么登录墙、要么正文过短，**直接换下一条结果不要硬塞 context**。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要读取的网页 URL' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_concept',
      description: '在正式生成完整策划方案之前，一次性产出 **3 条差异化的创意方向**（A/B/C），每条都含独立的主题、核心创意、活动框架、亮点、收益、风险、适用场景，供用户挑选。三条方向互为替代、性格不同（例如稳打 vs 出圈 vs 极致体验）。适用场景：完成 web_search 之后、run_strategy 之前；或用户对已呈现的三条方向都不满意时（把反馈写入 user_feedback 重新生成）。约 15-25 秒出一版，调用前告知用户稍等。',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: '品牌或项目名称' },
          event_description: { type: 'string', description: '活动描述（类型、规模、主题等）' },
          goal: { type: 'string', description: '活动核心目标' },
          audience: { type: 'string', description: '目标受众' },
          tone: { type: 'string', description: '风格调性' },
          budget: { type: 'string', description: '预算量级' },
          requirements: { type: 'string', description: '特殊要求或限制条件' },
          user_feedback: { type: 'string', description: '迭代时填：用户对上一版创意方向的反馈或调整意见。首次调用留空。' }
        },
        required: ['brand']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'approve_concept',
      description: '在用户明确挑选了 A/B/C 其中一条方向之后、调用 run_strategy 之前使用，把被选中的那条方向锁定为硬约束。只在用户通过 ask_user 或主动表达"选 A / 按 B 方向 / 就用 C"后调用。必须通过 direction_label 参数指明用户选了哪条。',
      parameters: {
        type: 'object',
        properties: {
          direction_label: {
            type: 'string',
            description: '用户选中的方向标签，A、B 或 C。如果无法从用户回复中明确判断，应先再问一次而不是瞎猜。',
            enum: ['A', 'B', 'C']
          },
          note: { type: 'string', description: '可选：客户确认时的补充说明或微调要求' }
        },
        required: ['direction_label']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_strategy',
      description: '基于已收集的研究信息，制定完整的活动策划方案，并生成策划文档。完成后由用户决定是否进行专家评审。',
      parameters: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: '品牌或项目名称' },
          event_description: { type: 'string', description: '活动描述（类型、规模、主题等）' },
          goal: { type: 'string', description: '活动核心目标' },
          audience: { type: 'string', description: '目标受众' },
          budget: { type: 'string', description: '预算（如"500万"）' },
          tone: { type: 'string', description: '风格调性（如"科技感、高端、年轻"）' },
          requirements: { type: 'string', description: '特殊要求或限制条件' },
          research_context: { type: 'string', description: '对本次搜索内容的补充摘要（可选）。系统会自动整合所有 web_search 的原始结果，无需重复罗列，只需写搜索中未体现的额外判断或背景即可' }
        },
        required: ['brand', 'event_description', 'goal']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'review_strategy',
      description: '对当前已生成的策划方案进行专家评审，给出评分、优点、不足和改进建议。只在用户明确要求评审时调用（用户说"评审""看看方案质量""专家意见"等）。',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '评审侧重点（可选），例如"重点看执行落地性"或"关注预算合理性"' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_ppt',
      description: '根据已制定的策划方案生成 PPT 文件，包含自动配图搜索。只在用户明确同意生成 PPT 后调用。',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: '给 PPT 生成的额外说明或调整要求（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_workspace_doc',
      description: '读取当前工作空间中某份文档的完整内容。适合继承历史策划方案、参考过去案例、了解品牌背景信息；也适合用户明确要求"打开/查看/预览这份文档"时，把文档呈现到右侧预览面板。文档 ID 可从系统提示词的文档列表中获取。返回值会带 outline（全部标题列表），在准备调用 patch_workspace_doc_section 做局部编辑时非常有用——可以先读文档拿到准确的 heading 文本再发 patch。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '文档 ID，格式如 doc_abc123' },
          focus: { type: 'string', description: '可选：本次读取重点关注的方向，例如"品牌调性"、"活动亮点"、"预算规模"' },
          preview: { type: 'boolean', description: '可选：是否把文档推送到右侧预览面板。当用户说"打开/查看/看一下/预览/展示这份文档"时设为 true；仅需要读内容做参考/继承时保持默认 false。' },
          full: { type: 'boolean', description: '可选：是否返回不截断的完整正文。准备做局部编辑时建议设为 true（上限拉到 32k 字）；默认 false，正文上限 8k 字。' }
        },
        required: ['doc_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_to_workspace',
      description: '把当前生成的内容（策划文档、分析报告、创意提案等）保存为工作空间中的一份新文档。PPT 会在生成后自动保存，无需手动调用。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文档标题' },
          content: { type: 'string', description: '文档内容（markdown 格式）' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_workspace_doc',
      description: '整体替换工作空间中已有文档的内容（原内容会被完全覆盖）。⚠️仅用于"大刀阔斧重写/换方向/换整套结构"。如果用户只是想改某一章、某一段、某条 KPI、某个预算项——请务必改用 patch_workspace_doc_section，按章节级局部编辑；追加一整段新章节则用 append_workspace_doc。滥用 update_workspace_doc 会导致 token 浪费、格式丢失、JSON 截断。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要更新的文档 ID' },
          content: { type: 'string', description: '新的完整文档内容（会完全替换原内容）' },
          title: { type: 'string', description: '可选：同时修改文档标题' }
        },
        required: ['doc_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'patch_workspace_doc_section',
      description: '对已有文档做"章节级局部编辑"——按标题（heading）定位一段，然后替换/追加/前置/删除这一段，不会动到其它章节。✅首选场景：用户说"第三章再加一个亮点""把预算部分改保守点""删掉风险应对那节""在六大实验室里再加一个 Lab"。相比 update_workspace_doc 省 token、保留其它章节格式，且支持模糊标题匹配。匹配规则：会按 heading 参数对文档所有 # / ## / ### 标题做标准化模糊匹配（优先完全匹配 > 前后缀 > 包含），命中多个时会返回错误并列出候选——此时用更完整的标题或加 heading_level 消歧。工具返回里会带当前 outline（全部标题列表），方便继续下一次编辑。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要编辑的文档 ID' },
          heading: { type: 'string', description: '要定位的章节标题（可以写部分关键词，会模糊匹配）。例："第二章"、"六大座舱实验室"、"预算框架"' },
          heading_level: { type: 'number', description: '可选：章节层级（1-6），当多个标题同名时用来消歧。例：## 第二章 用 2，### 亮点1 用 3' },
          mode: {
            type: 'string',
            enum: ['replace', 'append', 'prepend', 'delete'],
            description: 'replace=整段替换(含标题)；append=在该段末尾追加(该段内部最后加料)；prepend=紧接标题之后插入；delete=整段删除(包含标题和正文)'
          },
          content: { type: 'string', description: '新的 Markdown 片段。replace 模式下如果不以 heading 开头，会自动保留原标题。delete 模式可省略。' }
        },
        required: ['doc_id', 'heading', 'mode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_replace_in_doc',
      description: '对已有文档做"全文/章节内字符串替换"。✅最佳场景：用户说"把『五大实验室』全部改成『六大实验室』""把预算 500 万改成 800 万""把日期改为 5 月 20 日"——这种"单点替换、不重写章节"的需求。比 patch_workspace_doc_section 更省 token、不丢格式（保留加粗/高亮/列表结构）。⚠️局限：(1) 跨格式拆分的文本不会匹配——如果"五大实验室"中"五大"被加粗、"实验室"没加粗，会被拆成两个 text 节点导致匹配失败，这种情况降级用 patch_workspace_doc_section。(2) 不支持正则。(3) 只改纯文本字面量，不影响图片/代码块结构。返回 replaced_count 表示实际替换了几处，0 处时会提示原因。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要编辑的文档 ID' },
          find: { type: 'string', description: '要查找的字符串（精确匹配，不是正则）。例："五大实验室"、"500万"、"4 月 20 日"' },
          replace: { type: 'string', description: '要替换成的字符串。可以为空（""），等同于"删除这个词"。' },
          scope_heading: { type: 'string', description: '可选：限定只在某个章节内替换。不传则全文替换。例：传"预算"只在"## 预算"那节里替换，避免误改其它地方的"500万"' },
          heading_level: { type: 'number', description: '可选：scope_heading 标题层级 (1-6)，多个同名标题时消歧' },
          case_sensitive: { type: 'boolean', description: '可选：是否区分大小写。默认 true。中文场景一般保持默认；英文/缩写不确定大小写时设为 false。' },
          max_replacements: { type: 'number', description: '可选：最多替换次数上限，默认 50，上限 200。用于安全兜底，防止误把高频词全替换。如果用户明确说"全部"，可以设大一点。' }
        },
        required: ['doc_id', 'find', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_workspace_doc',
      description: '在已有文档的"最末尾"追加一段全新的 Markdown（通常是一整节新内容）。适合"在整份方案后再挂一节"（如补"附录""后续行动项"）。⚠️注意：如果用户是想在某已有章节内部追加内容（例如"给第三章再加一个亮点""在预算部分补一条"），应改用 patch_workspace_doc_section + mode=append，那才是章节内部追加。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要追加的文档 ID' },
          content: { type: 'string', description: '要追加的 Markdown 片段（只需这一段，不要重复原文）' }
        },
        required: ['doc_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_workspace_docs',
      description: '列出当前工作空间中所有可见文档的 id、名称、类型、角色、更新时间和摘要。适合当系统提示词里的文档列表太旧/太长，或者用户说"空间里有什么""我之前存了什么"时使用。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_workspace_docs',
      description: '在当前工作空间的文档名和正文片段里按关键词搜索，返回命中文档及上下文片段。适合"找一下之前做过的 XX 方案""我记得存过一篇关于 XX 的文档"这类请求；不同于 web_search，这个只搜空间内部。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词（中文英文均可）' },
          limit: { type: 'number', description: '最多返回条数，默认 8，建议 4-12' }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_workspace_folder',
      description: '在当前工作空间下或指定父节点下新建一个文件夹，用于归类相关文档。适合用户说"新建一个文件夹""把这些归到一个目录里"时使用。同名文件夹已存在时直接复用，不会重复创建。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件夹名称' },
          parent_id: { type: 'string', description: '可选：父节点 ID（空间 ID 或另一个文件夹 ID）。不填则创建在当前空间根目录下。' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rename_workspace_doc',
      description: '重命名工作空间中的某个文档或文件夹（只改名字，不动内容）。适合用户说"把这份文档改名为 XX""这个文件夹改叫 YY"时使用。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要重命名的节点 ID（可以是文档或文件夹）' },
          new_name: { type: 'string', description: '新名称' }
        },
        required: ['doc_id', 'new_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_workspace_doc_role',
      description: '给文档打上语义角色标签，用于后续任务识别这份文档是"需求""参考""草稿"。role 可选：requirements（用户提供的需求/brief）、reference（参考案例/竞品资料）、draft（临时草稿）、空串（清除标签）。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '文档 ID' },
          role: { type: 'string', enum: ['requirements', 'reference', 'draft', ''], description: '角色标签' }
        },
        required: ['doc_id', 'role']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_workspace_doc',
      description: `删除工作空间中的文档或文件夹（文件夹会连同其下所有子节点一起删除，不可恢复）。**必须走两步确认流程，禁止一步到位**：

步骤 1：先不带 confirmed 参数调用本工具（仅传 doc_id）。工具会返回 requires_confirmation=true 并登记一次待确认删除。
步骤 2：紧接着调用 ask_user（type="confirmation"，header="确认删除"），在 question 里明确说出将要删除的文档名（例如"确定要删除「XXX 方案初稿」吗？删除后不可恢复"），options 至少包含「确认删除」和「取消」两项。
步骤 3：只有当用户在该 ask_user 里明确回复"确认删除/确定/同意"等正面答复后，才能再次调用本工具，并带上 confirmed=true。

严禁第一次调用就带 confirmed=true；严禁跳过 ask_user。如果用户说"算了/取消/不删了"，不要再次调用本工具，改用自然语言回复即可。`,
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '要删除的节点 ID（文档或文件夹）' },
          confirmed: { type: 'boolean', description: '第一次调用留空；用户通过 ask_user 明确确认后，第二次调用时才设为 true' },
          reason: { type: 'string', description: '可选：简述删除原因（例如"用户要求清理旧方案"），方便事后回溯' }
        },
        required: ['doc_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: `暂停当前任务，向用户提出一个问题并等待回答。只在以下情况使用：(1) 缺少品牌/项目名称这类无法假设的信息；(2) 用户需要在两个截然不同的方向中做选择；(3) 需要用户确认策划文档才能进入下一步；(4) challenge_brief 发现硬伤需要用户拍板取舍。禁止在可以合理假设的情况下使用（如受众、预算、风格等）。每次只问一个问题，用自然口语而非表单语气。

**问得深的四个杠杆（问问题前先过一遍）**：
1. **先亮假设再确认**：不要裸问"预算多少？"。先说"我按行业基准猜你这场 50-80 万合理，你是比这多还是比这少？"——用户回答会更准。
2. **问取舍，不问需求**：不要问"你想要什么风格？"，要问"如果必须砍一个：场地规模 vs 阵容咖位，你砍哪个？"——逼出真实优先级。
3. **挖动机**：不要停在"你想要什么"，而是"为什么今年突然要做？""为什么非得这个调性？"——挖到更早的约束，往往能推翻表面需求。
4. **options 带代价**：如果给 options，每个 option.description 必须写清"选这个意味着放弃什么/承担什么"，而不是只说"选这个继续"。用户做取舍才是做决定。

**三条浅问禁忌（写完检查一下）**：
- ❌ 开放式要信息（"预算多少？""什么风格？""受众是谁？"）—— 这些应该自己合理假设后写进 brief.assumptions，不要停下来问。
- ❌ 纯 yes/no 确认（"这个方向可以吗？""对吗？"）—— 得到的信息量几乎为零，改成"让用户在两个有明确差异的选项里挑"。
- ❌ 复述型问题（"我理解你想 XX，对吗？"）—— 零增量。要么省略这句直接推进，要么把问题升级成"在 XX 方向上，你更偏 A 还是 B"。`,
      parameters: {
        type: 'object',
        properties: {
          header: {
            type: 'string',
            description: '可选。给这次提问一个很短的标题，适合显示在输入框上方的选择面板里，例如"确认品牌""选择方向""下一步"。'
          },
          question: {
            type: 'string',
            description: '要问的问题，用自然对话语气。如果你有合理猜测，可先说出猜测再让用户确认，比"直接提问"更自然。'
          },
          type: {
            type: 'string',
            enum: ['missing_info', 'ambiguous', 'confirmation', 'suggestion'],
            description: 'missing_info=缺少无法假设的核心信息；ambiguous=两个方向都合理，需用户选择；confirmation=需要用户明确同意才能执行高代价操作；suggestion=提供选项让用户选择偏好'
          },
          options: {
            type: 'array',
            description: '可选。给用户提供 2-4 个可直接选择的回复项。不要包含"其他"，用户始终可以直接输入自己的话。',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '用户看到的选项标题，1-12 个字为宜' },
                value: { type: 'string', description: '用户点击后实际回传给模型的回复文本' },
                description: { type: 'string', description: '可选。用于解释这个选项意味着什么或会如何继续。' }
              },
              required: ['label', 'value']
            }
          }
        },
        required: ['question', 'type']
      }
    }
  }
];

module.exports = { TOOL_DEFINITIONS };
