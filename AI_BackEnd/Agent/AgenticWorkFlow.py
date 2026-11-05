# Agentic Workflow Orchestration
# Compiles specialized state graphs for routing, search, database RAG, and business intelligence analysis.

from Utils.ModelLoader import modelLoader
from langgraph.graph import StateGraph, MessagesState, END, START
from langgraph.prebuilt import ToolNode, tools_condition
from Tools.webSearch import webSearch
from Tools.CRUD import databaseCrudOperations
from Tools.runPython import runPython
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from DB.connect import dataBaseConnection


class GeneralAgent:
    def __init__(self, system_prompt, model_provider: str = "groq", model_id: str = None):
        self.model_loader = modelLoader(model_provider=model_provider, model_id=model_id)
        self.llm = self.model_loader.load_llm()
        self.graph = None
        self.system_prompt = system_prompt

    async def agent_function(self, state: MessagesState):
        """Main agent function (async so client cancel can stop in-flight LLM calls)."""
        user_question = state["messages"]
        input_question = [self.system_prompt] + user_question
        response = await self.llm.ainvoke(input_question)
        return {"messages": [response]}

    def build_graph(self, has_tools: bool):
        graph_builder = StateGraph(MessagesState)
        graph_builder.add_node("agent", self.agent_function)
        graph_builder.add_edge(START, "agent")
        if has_tools:
            graph_builder.add_node("tools", ToolNode(tools=self.tools))
            graph_builder.add_conditional_edges("agent", tools_condition)
            graph_builder.add_edge("tools", "agent")
        else:
            graph_builder.add_edge("agent", END)
        self.graph = graph_builder.compile()
        return self.graph

    def __call__(self):
        return self.build_graph(False)


class SearchAgent(GeneralAgent):
    def __init__(self, system_prompt, model_provider="groq", model_id=None):
        super().__init__(system_prompt, model_provider, model_id=model_id)
        self.web_search = webSearch()
        self.tools = []
        self.tools.extend([*self.web_search.search_tool_list])
        self.llm = self.model_loader.get_model_chain(tools=self.tools)

    def __call__(self):
        return self.build_graph(True)


class RagAgent(GeneralAgent):
    def __init__(self, system_prompt, model_provider="groq", db=None, model_id=None):
        super().__init__(system_prompt, model_provider, model_id=model_id)
        if db is not None:
            self.db = db
        else:
            self.dataBaseConnection = dataBaseConnection()
            self.db = self.dataBaseConnection.connection()
        if self.db is None:
            raise RuntimeError(
                "Please connect to a database first to answer questions about your data. "
                "You can connect a database or upload a dataset using the Data Source button in the sidebar."
            )
        toolkit_llm = self.model_loader.get_primary_model()
        self.sqlToolKit = SQLDatabaseToolkit(db=self.db, llm=toolkit_llm)
        self.web_search = webSearch()
        self.tools = []
        self.tools.extend([*self.web_search.search_tool_list, *self.sqlToolKit.get_tools()])
        self.llm = self.model_loader.get_model_chain(tools=self.tools)

    def __call__(self):
        return self.build_graph(True)


class CrudAgent(GeneralAgent):
    def __init__(self, system_prompt, model_provider="groq", model_id=None):
        super().__init__(system_prompt, model_provider, model_id=model_id)
        self.databaseCrudOperations = databaseCrudOperations()
        self.tools = []
        self.tools.extend([*self.databaseCrudOperations.dataBaseCrudToolList])
        self.llm = self.model_loader.get_model_chain(tools=self.tools)

    def __call__(self):
        return self.build_graph(True)


class analysisAgent(GeneralAgent):
    def __init__(self, system_prompt, model_provider="groq", db=None, model_id=None):
        super().__init__(system_prompt, model_provider, model_id=model_id)
        if db is not None:
            self.db = db
        else:
            self.dataBaseConnection = dataBaseConnection()
            self.db = self.dataBaseConnection.connection()
        if self.db is None:
            raise RuntimeError(
                "Please connect to a database first to answer questions about your data. "
                "You can connect a database or upload a dataset using the Data Source button in the sidebar."
            )
        toolkit_llm = self.model_loader.get_primary_model()
        self.sqlToolKit = SQLDatabaseToolkit(db=self.db, llm=toolkit_llm)
        self.runPythonTools = runPython()
        self.tools = []
        self.tools.extend([*self.sqlToolKit.get_tools(), *self.runPythonTools.runPythonToolList])
        self.llm = self.model_loader.get_model_chain(tools=self.tools)

    def __call__(self):
        return self.build_graph(True)
